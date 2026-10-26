import { domainFailure } from "../../lib/domain/contracts.ts";
import type { Command,SiteIdentity } from "../../lib/domain/contracts.ts";
import type { TutorState } from "../../lib/tutor/contracts.ts";
import { editorFeedbackRecord,editorReviewRecord } from "../../lib/editor/contracts.ts";
import type { EditorReviewOutput } from "../../lib/editor/contracts.ts";
import { beginEditorReview,finishEditorReview } from "../../lib/editor/review.ts";
import { requireCurrentTutor } from "../../lib/tutor/current.ts";
import { previousTutor,readTutorAttempt,saveTutorTransition,tutorEvidenceGuards } from "./tutor.ts";
import { editorFeedbackStatements } from "./editor-feedback.ts";
import type { Receipt } from "./atomic.ts";
export async function beginStoredEditorReview(db:D1Database,bucket:R2Bucket,cmd:Command,id:string):Promise<Receipt> {
  const state=await previousTutor(db,cmd,id);await requireCurrentTutor(db,bucket,cmd.owner,state);const next=beginEditorReview(state);
  return saveTutorTransition(db,cmd,next,"editor-review",{id},(requestId)=>tutorEvidenceGuards(db,cmd.owner,next,requestId));
}
export async function saveStoredEditorReview(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,state:TutorState,output:EditorReviewOutput,now:number):Promise<Receipt> {
  if(!state.pending) throw domainFailure("version_conflict","editor.review-pending",null);await requireCurrentTutor(db,bucket,owner,state);
  const review=editorReviewRecord.parse({id:crypto.randomUUID(),output,committedAt:now});const feedback=editorFeedbackRecord.parse({id:crypto.randomUUID(),helpEventId:crypto.randomUUID(),helpAttemptId:crypto.randomUUID(),itemIds:output.remaining.items.map(()=>crypto.randomUUID()),output:output.remaining,committedAt:now});
  const next=finishEditorReview(state,review,feedback);const attempt=await readTutorAttempt(db,owner,state);
  return saveTutorTransition(db,{owner,requestKey:`${state.pending.key}:complete`,expectedVersion:state.version},next,"editor-review-complete",output,(requestId)=>editorFeedbackStatements(db,owner,state,next,feedback,attempt,requestId));
}
