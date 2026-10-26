import { parseReviewSubmission } from "../../lib/reviews/submission.ts";
import { normalizedPerformanceText } from "../../lib/tutor/identity.ts";
import { contentHash,domainFailure } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { tutorAnswer } from "../../lib/tutor/contracts.ts";
import type { TutorState, TutorDraft, TutorAnswer } from "../../lib/tutor/contracts.ts";
import { beginDirectTutorAnswer, beginTutorRecall, finishTutorSession, pauseTutor, resumeTutor, reviseTutorAnswer, saveTutorAnswer, saveTutorDraft } from "../../lib/tutor/state.ts";
import type { TutorStorageAction } from "../../lib/tutor/request.ts";
import { getRegisteredMaterial } from "../../lib/materials/download.ts";
import { headMaterialObject } from "../../lib/materials/object.ts";
import { createTutor, previousTutor, readTutorAttempt, saveTutorTransition } from "./tutor.ts";
import type { TutorWritePlan, TutorAttempt } from "./tutor.ts";
import { guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

export async function requireAnswerFiles(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,state:TutorState,draft:TutorDraft):Promise<void> {
  for(const id of draft.fileIds) {
    const transfer=await getRegisteredMaterial(db,owner,id);
    if(transfer.courseId!==state.start.bundle.unit.courseId || transfer.metadata.kind!=="image" || transfer.metadata.role!=="answer") throw domainFailure("reference_conflict","tutor.answer-file-owner-course-kind",null);
    await headMaterialObject(bucket,transfer);
  }
}
export function fileGuards(db:D1Database,cmd:Command,state:TutorState,draft:TutorDraft,requestId:string):readonly D1PreparedStatement[] {
  return draft.fileIds.map((id,index)=>requireInBatch(db,cmd.owner.userId,requestId,index+100,"EXISTS(SELECT 1 FROM material_files f JOIN materials m ON m.owner_id=f.owner_id AND m.id=f.material_id JOIN material_transfers t ON t.owner_id=f.owner_id AND t.id=f.transfer_id WHERE f.owner_id=? AND f.material_id=? AND m.course_id=? AND t.state='registered' AND json_extract(t.metadata,'$.kind')='image' AND json_extract(t.metadata,'$.role')='answer')",[cmd.owner.userId,id,state.start.bundle.unit.courseId]));
}
export function draftStatement(db:D1Database,cmd:Command,state:TutorState,requestId:string):D1PreparedStatement {
  return db.prepare("INSERT INTO answer_drafts VALUES (?,?,1,?,?,?) ON CONFLICT(owner_id,attempt_id) DO UPDATE SET text=excluded.text,version=version+1,last_request_id=excluded.last_request_id").bind(cmd.owner.userId,state.question.attemptId,requestId,state.question.attemptId,state.draft.text);
}
export async function saveStoredTutorDraft(db:D1Database,bucket:R2Bucket,cmd:Command,id:string,draft:TutorDraft):Promise<Receipt> {
  const previous=await previousTutor(db,cmd,id);const state=saveTutorDraft(previous,draft); await requireAnswerFiles(db,bucket,cmd.owner,state,draft);
  const attempt=await readTutorAttempt(db,cmd.owner,previous);
  return saveTutorTransition(db,cmd,state,"draft",{id,draft},(requestId)=>[...guardedUpdate(db,"attempts",cmd.owner.userId,state.question.attemptId,attempt.version,requestId,1,"status=status",[],"status='awaiting-answer'",[]),...fileGuards(db,cmd,state,draft,requestId),draftStatement(db,cmd,state,requestId)]);
}
export async function answerContentFingerprint(db:D1Database,owner:SiteIdentity,draft:TutorDraft):Promise<string> {
  const files=await Promise.all(draft.fileIds.map(async (fileId):Promise<string>=>(await getRegisteredMaterial(db,owner,fileId)).metadata.sha256));
  return contentHash({text:normalizedPerformanceText(draft.text),files:[...files].sort()});
}
export type TutorSubmission=Readonly<{state:TutorState;attempt:TutorAttempt;answer:TutorAnswer}>;
export async function prepareTutorSubmission(db:D1Database,bucket:R2Bucket,cmd:Command,id:string,answerId:string,draft:TutorDraft,now:number):Promise<TutorSubmission> {
  const previous=await previousTutor(db,cmd,id);if(previous.review && previous.question.mode!=="new-condition") parseReviewSubmission(previous.review.task,draft.text);await requireAnswerFiles(db,bucket,cmd.owner,previous,draft);
  const helped=await readStorage("tutor.help-history",()=>db.prepare("SELECT EXISTS(SELECT 1 FROM help_events h JOIN attempts a ON a.owner_id=h.owner_id AND a.id=h.attempt_id WHERE a.owner_id=? AND a.question_id=?) AS helped").bind(cmd.owner.userId,previous.question.id).first<number>("helped"));
  if(helped===null) throw domainFailure("storage_failure","tutor.help-history-result",null);
  const fingerprint=await answerContentFingerprint(db,cmd.owner,draft);
  const answer=tutorAnswer.parse({contentFingerprint:fingerprint,id:answerId,questionId:previous.question.id,attemptId:previous.question.attemptId,...draft,submittedAt:now,helped:helped===1});
  return {state:{...saveTutorAnswer(previous,answer),draft},attempt:await readTutorAttempt(db,cmd.owner,previous),answer};
}
export function tutorAnswerStatements(db:D1Database,cmd:Command,submission:TutorSubmission,requestId:string):readonly D1PreparedStatement[] {
  const {state,attempt,answer}=submission;const draft=state.draft;
  return [
    ...guardedUpdate(db,"attempts",cmd.owner.userId,state.question.attemptId,attempt.version,requestId,1,"status='ready'",[],"status='awaiting-answer'",[]),...fileGuards(db,cmd,state,draft,requestId),draftStatement(db,cmd,state,requestId),
    db.prepare("INSERT INTO answers VALUES (?,?,?,?,?,?)").bind(cmd.owner.userId,answer.id,answer.attemptId,attempt.version+1,answer.text.length>0 ? answer.text : "[사진 답안]",answer.submittedAt),
    ...draft.fileIds.map((fileId)=>db.prepare("INSERT INTO answer_files VALUES (?,?,?,?)").bind(cmd.owner.userId,answer.id,fileId,answer.submittedAt)),
  ];
}
export async function submitStoredTutorAnswer(db:D1Database,bucket:R2Bucket,cmd:Command,id:string,answerId:string,draft:TutorDraft,now:number):Promise<Receipt> {
  const submission=await prepareTutorSubmission(db,bucket,cmd,id,answerId,draft,now);
  return saveTutorTransition(db,cmd,submission.state,"answer",{id,answerId,draft},(requestId)=>tutorAnswerStatements(db,cmd,submission,requestId));
}

async function saveRecall(db:D1Database,cmd:Command,previous:TutorState,next:TutorState,action:string):Promise<Receipt> {
  const attempt=await readTutorAttempt(db,cmd.owner,previous);
  return saveTutorTransition(db,cmd,next,action,{id:previous.id},(requestId)=>[...guardedUpdate(db,"attempts",cmd.owner.userId,previous.question.attemptId,attempt.version,requestId,1,"status='awaiting-answer',hidden_material=1",[],"status='ready' AND NOT EXISTS(SELECT 1 FROM answers WHERE owner_id=? AND attempt_id=?)",[cmd.owner.userId,previous.question.attemptId])]);
}
export async function reviseStoredTutor(db:D1Database,cmd:Command,previous:TutorState,attemptId:string):Promise<Receipt> {
  const next=reviseTutorAnswer(previous,attemptId);
  return saveTutorTransition(db,cmd,next,"revise",{id:previous.id,attemptId},(requestId)=>[db.prepare("INSERT INTO attempts VALUES (?,?,1,?,?,?,?,?,1,'awaiting-answer')").bind(cmd.owner.userId,next.question.attemptId,requestId,next.id,next.question.id,next.question.originalQuestionId,next.question.mode==="new-condition" ? "new-condition" : "initial")]);
}
async function saveSessionStatus(db:D1Database,cmd:Command,state:TutorState,status:"active"|"paused"|"finished",action:string):Promise<Receipt> {
  const row=await readStorage("tutor.session-version",()=>db.prepare("SELECT version FROM sessions WHERE owner_id=? AND id=?").bind(cmd.owner.userId,state.id).first<{version:number}>());
  if(!row) throw domainFailure("reference_conflict","tutor.session-missing",null);
  return saveTutorTransition(db,cmd,state,action,{id:state.id},(requestId)=>guardedUpdate(db,"sessions",cmd.owner.userId,state.id,row.version,requestId,1,"status=?",[status],"1",[]));
}
export async function dispatchTutorAction(db:D1Database,bucket:R2Bucket,cmd:Command,input:TutorStorageAction,now:number):Promise<Receipt> {
  if(input.action==="start") return createTutor(db,bucket,cmd,input,now);
  if(input.action==="draft") return saveStoredTutorDraft(db,bucket,cmd,input.id,input.draft);
  if(input.action==="submit") return submitStoredTutorAnswer(db,bucket,cmd,input.id,input.answerId,input.draft,now);
  const previous=await previousTutor(db,cmd,input.id);
  switch(input.action) {
    case "recall":return saveRecall(db,cmd,previous,beginTutorRecall(previous),"recall");
    case "direct":return saveRecall(db,cmd,previous,beginDirectTutorAnswer(previous),"direct");
    case "revise":return reviseStoredTutor(db,cmd,previous,input.attemptId);
    case "pause":return saveSessionStatus(db,cmd,pauseTutor(previous),"paused","pause");
    case "resume":return saveSessionStatus(db,cmd,resumeTutor(previous),"active","resume");
    case "finish":return saveSessionStatus(db,cmd,finishTutorSession(previous),"finished","finish");
  }
}
export function emptyTutorPlan():ReturnType<TutorWritePlan> { return []; }
