import { previousTutor,readTutorAttempt,saveTutorTransition } from "./tutor.ts";
import { requireAnswerFiles,answerContentFingerprint,fileGuards,draftStatement } from "./tutor-actions.ts";
import { guardedUpdate } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { domainFailure } from "../../lib/domain/contracts.ts";
import type { TutorDraft } from "../../lib/tutor/contracts.ts";
import { saveEditorRevisionDraft,submitEditorRevision } from "../../lib/editor/revision.ts";
import type { EditorRevisionInput } from "../../lib/editor/revision.ts";

export async function saveStoredEditorRevisionDraft(db:D1Database,bucket:R2Bucket,cmd:Command,id:string,draft:TutorDraft,reason:string):Promise<Receipt> {
  const previous=await previousTutor(db,cmd,id);const next=saveEditorRevisionDraft(previous,draft,reason);await requireAnswerFiles(db,bucket,cmd.owner,previous,draft);
  return saveTutorTransition(db,cmd,next,"editor-revision-draft",{id,draft,reason},(requestId)=>[...fileGuards(db,cmd,next,draft,requestId),draftStatement(db,cmd,next,requestId)]);
}
export async function submitStoredEditorRevision(db:D1Database,bucket:R2Bucket,cmd:Command,id:string,input:EditorRevisionInput):Promise<Receipt> {
  const previous=await previousTutor(db,cmd,id);await requireAnswerFiles(db,bucket,cmd.owner,previous,input.draft);const next=submitEditorRevision(previous,{...input,contentFingerprint:await answerContentFingerprint(db,cmd.owner,input.draft)});
  const attempt=await readTutorAttempt(db,cmd.owner,previous);const feedback=previous.editor?.feedbacks.at(-1);const answer=next.answers.at(-1);
  if(!feedback || !answer) throw domainFailure("reference_conflict","editor.revision-link",null);
  return saveTutorTransition(db,cmd,next,"editor-revision-submit",{id,answerId:input.answerId,attemptId:input.attemptId,draft:input.draft,reason:input.reason},(requestId)=>[
    ...guardedUpdate(db,"attempts",cmd.owner.userId,previous.question.attemptId,attempt.version,requestId,1,"status='ready'",[],"status='awaiting-revision'",[]),
    ...fileGuards(db,cmd,next,input.draft,requestId),
    db.prepare("INSERT INTO attempts VALUES (?,?,1,?,?,?,?,?,1,'ready')").bind(cmd.owner.userId,input.attemptId,requestId,next.id,next.question.id,next.question.originalQuestionId,"initial"),
    db.prepare("INSERT INTO answers VALUES (?,?,?,1,?,?)").bind(cmd.owner.userId,answer.id,answer.attemptId,answer.text.length>0 ? answer.text : "[사진 수정본]",answer.submittedAt),
    ...answer.fileIds.map((fileId)=>db.prepare("INSERT INTO answer_files VALUES (?,?,?,?)").bind(cmd.owner.userId,answer.id,fileId,answer.submittedAt)),
    ...feedback.itemIds.map((feedbackId)=>db.prepare("INSERT INTO revisions VALUES (?,?,?,?,?,?,?)").bind(cmd.owner.userId,crypto.randomUUID(),feedback.output.answerId,feedbackId,answer.text.length>0 ? answer.text : "[사진 수정본]",input.reason,answer.submittedAt)),
    draftStatement(db,cmd,next,requestId),
  ]);
}
