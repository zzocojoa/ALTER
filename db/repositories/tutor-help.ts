import { recordId,timestamp,domainFailure } from "../../lib/domain/contracts.ts";
import type { Command,SiteIdentity } from "../../lib/domain/contracts.ts";
import type { TutorState,TutorScaffold,TutorHelpStage } from "../../lib/tutor/contracts.ts";
import { finishTutorHelp } from "../../lib/tutor/help.ts";
import { requireCurrentTutor } from "../../lib/tutor/current.ts";
import { saveTutorTransition,tutorEvidenceGuards } from "./tutor.ts";
import { executeAtomic,readStorage,requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
const helpKinds:Readonly<Record<TutorHelpStage,Readonly<{kind:"hint"|"explanation"|"answer";level:number}>>>={direction:{kind:"hint",level:1},"small-question":{kind:"hint",level:2},"similar-example":{kind:"explanation",level:2},"full-explanation":{kind:"answer",level:3}};
export async function saveStoredTutorHelp(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,previous:TutorState,output:TutorScaffold,now:number):Promise<Receipt> {
  if(!previous.pending) throw domainFailure("version_conflict","tutor.help-request-required",null);
  await requireCurrentTutor(db,bucket,owner,previous);
  const next=finishTutorHelp(previous,output,crypto.randomUUID(),crypto.randomUUID(),now);const help=next.help.at(-1);if(!help) throw domainFailure("reference_conflict","tutor.help-event-required",null);
  const kind=helpKinds[help.stage];
  return saveTutorTransition(db,{owner,requestKey:`${previous.pending.key}:complete`,expectedVersion:previous.version},next,"help-complete",output,(requestId)=>[
    ...tutorEvidenceGuards(db,owner,next,requestId),
    db.prepare("INSERT INTO attempts VALUES (?,?,1,?,?,?,?,?,1,'awaiting-answer')").bind(owner.userId,next.question.attemptId,requestId,next.id,next.question.id,next.question.originalQuestionId,next.question.mode==="new-condition" ? "new-condition" : "initial"),
    db.prepare("INSERT INTO help_events VALUES (?,?,?,1,?,?,?)").bind(owner.userId,help.id,next.question.attemptId,kind.kind,kind.level,now),
    db.prepare("INSERT INTO tutor_help_details VALUES (?,?,?,?,?,?,?)").bind(owner.userId,help.id,next.id,help.answerId,help.stage,JSON.stringify(output),now),
  ]);
}
export async function acknowledgeTutorHelp(db:D1Database,cmd:Command,id:string,helpId:string,now:number):Promise<Receipt> {
  recordId.parse(id);recordId.parse(helpId);timestamp.parse(now);
  return executeAtomic(db,{...cmd,expectedVersion:1},"tutor.help-delivered",{id,helpId},helpId,1,(requestId)=>[
    requireInBatch(db,cmd.owner.userId,requestId,0,"EXISTS(SELECT 1 FROM tutor_help_details WHERE owner_id=? AND id=? AND session_id=?)",[cmd.owner.userId,helpId,id]),
    db.prepare("INSERT INTO tutor_help_deliveries VALUES (?,?,?) ON CONFLICT(owner_id,help_id) DO NOTHING").bind(cmd.owner.userId,helpId,now),
  ]);
}
export async function readHelpDelivery(db:D1Database,owner:SiteIdentity,helpId:string):Promise<number|null> {return readStorage("tutor.help-delivery",()=>db.prepare("SELECT delivered_at FROM tutor_help_deliveries WHERE owner_id=? AND help_id=?").bind(owner.userId,helpId).first<number>("delivered_at"));}
