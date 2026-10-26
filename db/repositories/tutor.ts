import { recordId, version, domainFailure } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { tutorState } from "../../lib/tutor/contracts.ts";
import type { TutorState } from "../../lib/tutor/contracts.ts";
import { initialTutor } from "../../lib/tutor/state.ts";
import { readTutorStart } from "./tutor-start.ts";
import { executeAtomic, guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { currentSourceGuard, currentUnitGuard } from "./librarian-links.ts";

type StateRow=Readonly<{state:string}>;
export async function getTutor(db:D1Database,owner:SiteIdentity,id:string):Promise<TutorState> {
  recordId.parse(id);
  const row=await readStorage("tutor.get",()=>db.prepare("SELECT state FROM tutor_sessions WHERE owner_id=? AND id=?").bind(owner.userId,id).first<StateRow>());
  if(!row) throw domainFailure("reference_conflict","tutor.owner-session",null);
  return tutorState.parse(JSON.parse(row.state));
}
export async function previousTutor(db:D1Database,cmd:Command,id:string):Promise<TutorState> {
  recordId.parse(id); version.parse(cmd.expectedVersion);
  const row=await readStorage("tutor.previous",()=>db.prepare("SELECT json_extract(content,'$.state') AS state FROM tutor_events WHERE owner_id=? AND session_id=? AND version=?").bind(cmd.owner.userId,id,cmd.expectedVersion).first<StateRow>());
  if(!row) throw domainFailure("version_conflict","tutor.previous-version",null);
  return tutorState.parse(JSON.parse(row.state));
}
export type TutorSummary=Readonly<{id:string;version:number;title:string;phase:TutorState["phase"]}>;
export async function listTutors(db:D1Database,owner:SiteIdentity):Promise<readonly TutorSummary[]> {
  const rows=await readStorage("tutor.list",()=>db.prepare("SELECT id,version,json_extract(state,'$.start.bundle.unit.title') AS title,json_extract(state,'$.phase') AS phase FROM tutor_sessions WHERE owner_id=? AND json_type(state,'$.editor') IS NULL ORDER BY rowid DESC LIMIT 30").bind(owner.userId).all<TutorSummary>());
  return rows.results;
}
function tutorEvent(db:D1Database,owner:SiteIdentity,state:TutorState,requestId:string,input:unknown):D1PreparedStatement {
  return db.prepare("INSERT INTO tutor_events VALUES (?,?,?,?,?,?)").bind(owner.userId,requestId,state.id,state.version,JSON.stringify({input,state}),Date.now());
}
export function tutorEvidenceGuards(db:D1Database,owner:SiteIdentity,state:TutorState,requestId:string):readonly D1PreparedStatement[] {
  const sources=state.start.bundle.sources;
  return [currentUnitGuard(db,owner,state.start.bundle.unit,requestId,10),...sources.map((source,index)=>currentSourceGuard(db,owner,source,requestId,11+index)),requireInBatch(db,owner.userId,requestId,11+sources.length,"(SELECT current_version_id FROM learning_results WHERE owner_id=? AND unit_id=?) IS ?",[owner.userId,state.start.bundle.unit.unitId,state.start.latest?.resultVersionId ?? null]),...state.start.reviews.map((review,index)=>requireInBatch(db,owner.userId,requestId,12+sources.length+index,"EXISTS(SELECT 1 FROM review_items WHERE owner_id=? AND id=? AND version=? AND correction_id IS ?)",[owner.userId,review.id,review.version,review.correctionId]))];
}
export async function createTutor(db:D1Database,bucket:R2Bucket,cmd:Command,input:Readonly<{id:string;scopeId:string;questionId:string;attemptId:string}>,now:number):Promise<Receipt> {
  if(cmd.expectedVersion!==1) throw domainFailure("version_conflict","tutor.start-version",null);
  const previous=await readStorage("tutor.start-replay",()=>db.prepare("SELECT content FROM tutor_events WHERE owner_id=? AND session_id=? AND version=1").bind(cmd.owner.userId,input.id).first<{content:string}>());
  const state=previous ? tutorState.parse(JSON.parse(previous.content).state) : initialTutor(input.id,await readTutorStart(db,bucket,cmd.owner,input.scopeId,now),input.questionId,input.attemptId);
  return executeAtomic(db,cmd,"tutor.start",input,state.id,1,(requestId)=>tutorCreationStatements(db,cmd,state,requestId,input));
}
export function tutorCreationStatements(db:D1Database,cmd:Command,state:TutorState,requestId:string,input:unknown):readonly D1PreparedStatement[] {
  return [
    requireInBatch(db,cmd.owner.userId,requestId,0,"NOT EXISTS(SELECT 1 FROM tutor_sessions WHERE owner_id=? AND json_extract(state,'$.phase')!='finished') AND NOT EXISTS(SELECT 1 FROM attempts WHERE owner_id=? AND status='awaiting-answer')",[cmd.owner.userId,cmd.owner.userId]),
    ...tutorEvidenceGuards(db,cmd.owner,state,requestId),
    db.prepare("INSERT INTO sessions VALUES (?,?,1,?,?,?,?,?,'active')").bind(cmd.owner.userId,state.id,requestId,state.start.bundle.unit.courseId,state.start.bundle.unit.unitId,state.start.bundle.unit.planVersionId,state.start.today),
    db.prepare("INSERT INTO questions VALUES (?,?,?,?,?)").bind(cmd.owner.userId,state.question.id,state.id,state.question.sourceRefIds[0],state.question.prompt),
    db.prepare("INSERT INTO attempts VALUES (?,?,1,?,?,?,?,?,?,?)").bind(cmd.owner.userId,state.question.attemptId,requestId,state.id,state.question.id,null,"initial",Number(state.phase==="awaiting-answer"),state.phase==="awaiting-answer" ? "awaiting-answer" : "ready"),
    db.prepare("INSERT INTO tutor_sessions VALUES (?,?,1,?,?,?)").bind(cmd.owner.userId,state.id,requestId,state.start.scopeId,JSON.stringify(state)),tutorEvent(db,cmd.owner,state,requestId,input),
  ];
}

export type TutorWritePlan=(requestId:string)=>readonly D1PreparedStatement[];
/** 상태 CAS와 답안·첨부·도움 사건을 한 batch에 넣어 0행 갱신도 전체 롤백합니다. */
export async function saveTutorTransition(db:D1Database,cmd:Command,state:TutorState,action:string,input:unknown,plan:TutorWritePlan):Promise<Receipt> {
  if(state.version!==cmd.expectedVersion+1) throw domainFailure("version_conflict","tutor.transition-version",null);
  return executeAtomic(db,cmd,`tutor.${action}`,input,state.id,state.version,(requestId)=>[
    ...guardedUpdate(db,"tutor_sessions",cmd.owner.userId,state.id,cmd.expectedVersion,requestId,0,"state=?",[JSON.stringify(state)],"1",[]),
    ...plan(requestId),tutorEvent(db,cmd.owner,state,requestId,input),
  ]);
}
export type TutorAttempt=Readonly<{version:number;status:string;hidden_material:number}>;
export async function readTutorAttempt(db:D1Database,owner:SiteIdentity,state:TutorState):Promise<TutorAttempt> {
  const row=await readStorage("tutor.attempt",()=>db.prepare("SELECT version,status,hidden_material FROM attempts WHERE owner_id=? AND id=? AND session_id=? AND question_id=?").bind(owner.userId,state.question.attemptId,state.id,state.question.id).first<TutorAttempt>());
  if(!row) throw domainFailure("reference_conflict","tutor.attempt-reference",null); return row;
}

/** 다른 회차의 설명 화면으로 현재 인출 상태를 우회하지 못하게 합니다. */
export async function requireTutorViewAccess(db:D1Database,owner:SiteIdentity,id:string):Promise<void> {
  const blocked=await readStorage("tutor.cross-session-visibility",()=>db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE owner_id=? AND session_id!=? AND status='awaiting-answer' AND hidden_material=1").bind(owner.userId,id).first<number>("n"));
  if(blocked===null) throw domainFailure("storage_failure","tutor.visibility-result",null);
  if(blocked>0) throw domainFailure("reference_conflict","tutor.other-session-hidden-recall",null);
}
