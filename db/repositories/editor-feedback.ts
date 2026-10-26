import { domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity,Command } from "../../lib/domain/contracts.ts";
import type { TutorState } from "../../lib/tutor/contracts.ts";
import type { EditorFeedbackOutput,EditorFeedbackRecord } from "../../lib/editor/contracts.ts";
import { editorFeedbackRecord } from "../../lib/editor/contracts.ts";
import { beginEditorFeedback,finishEditorFeedback } from "../../lib/editor/feedback.ts";
import { requireCurrentTutor } from "../../lib/tutor/current.ts";
import type { TutorAttempt } from "./tutor.ts";
import { previousTutor,readTutorAttempt,saveTutorTransition,tutorEvidenceGuards } from "./tutor.ts";
import { guardedUpdate } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

export async function beginStoredEditorFeedback(db:D1Database,bucket:R2Bucket,cmd:Command,id:string):Promise<Receipt> {
  const previous=await previousTutor(db,cmd,id);await requireCurrentTutor(db,bucket,cmd.owner,previous);const next=beginEditorFeedback(previous);
  return saveTutorTransition(db,cmd,next,"editor-feedback",{id},(requestId)=>tutorEvidenceGuards(db,cmd.owner,next,requestId));
}
export async function saveStoredEditorFeedback(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,state:TutorState,output:EditorFeedbackOutput,now:number):Promise<Receipt> {
  if(!state.pending) throw domainFailure("version_conflict","editor.feedback-pending",null);
  await requireCurrentTutor(db,bucket,owner,state);const attempt=await readTutorAttempt(db,owner,state);
  const record=editorFeedbackRecord.parse({id:crypto.randomUUID(),helpEventId:crypto.randomUUID(),helpAttemptId:crypto.randomUUID(),itemIds:output.items.map(()=>crypto.randomUUID()),output,committedAt:now});const next=finishEditorFeedback(state,record);
  return saveTutorTransition(db,{owner,requestKey:`${state.pending.key}:complete`,expectedVersion:state.version},next,"editor-feedback-complete",output,(requestId)=>editorFeedbackStatements(db,owner,state,next,record,attempt,requestId));
}
export function editorFeedbackStatements(db:D1Database,owner:SiteIdentity,state:TutorState,next:TutorState,record:EditorFeedbackRecord,attempt:TutorAttempt,requestId:string):readonly D1PreparedStatement[] {
  const output=record.output;const now=record.committedAt;
  return [
    ...tutorEvidenceGuards(db,owner,next,requestId),...guardedUpdate(db,"attempts",owner.userId,state.question.attemptId,attempt.version,requestId,1,"status=?",[output.items.length>0 ? "awaiting-revision" : "ready"],"status='ready'",[]),
    db.prepare("INSERT INTO attempts VALUES (?,?,1,?,?,?,?,?,1,'ready')").bind(owner.userId,record.helpAttemptId,requestId,state.id,state.question.id,state.question.originalQuestionId,"initial"),
    db.prepare("INSERT INTO help_events VALUES (?,?,?,?,?,?,?)").bind(owner.userId,record.helpEventId,record.helpAttemptId,1,"hint",1,now),
    ...record.itemIds.map((id,index)=>db.prepare("INSERT INTO feedback VALUES (?,?,?,?,?)").bind(owner.userId,id,output.answerId,index+1,JSON.stringify({versionId:output.versionId,basis:output.basis[output.items[index].basisIndex],item:output.items[index]}))),
  ];
}
