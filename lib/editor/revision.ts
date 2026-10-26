import { z } from "zod";
import { domainFailure,recordId,timestamp } from "../domain/contracts.ts";
import { tutorDraft,tutorAnswer,tutorState } from "../tutor/contracts.ts";
import type { TutorDraft,TutorState } from "../tutor/contracts.ts";
import { editorVersion } from "./contracts.ts";
import { currentEditorVersion } from "./evidence.ts";

export const editorRevisionInput=z.object({contentFingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional(),answerId:recordId,attemptId:recordId,draft:tutorDraft,reason:z.string().trim().min(1).max(4000),submittedAt:timestamp}).strict();
export type EditorRevisionInput=Readonly<z.infer<typeof editorRevisionInput>>;
export function saveEditorRevisionDraft(state:TutorState,draft:TutorDraft,reason:string):TutorState {
  if(state.editor?.phase!=="awaiting-revision" || state.pending || state.phase!=="answer-saved") throw domainFailure("version_conflict","editor.revision-wait-required",null);
  return tutorState.parse({...state,version:state.version+1,draft:tutorDraft.parse(draft),editor:{...state.editor,draftReason:z.string().max(4000).parse(reason)}});
}
/** 수정 내용과 이유가 모두 저장될 때만 재평가 대기로 이동합니다. */
export function submitEditorRevision(state:TutorState,value:EditorRevisionInput):TutorState {
  const input=editorRevisionInput.parse(value);const editor=state.editor;
  const parent=currentEditorVersion(state);const feedback=editor?.feedbacks.at(-1);
  if(!editor || editor.phase!=="awaiting-revision" || state.pending || state.phase!=="answer-saved" || !feedback || feedback.output.versionId!==parent.id || feedback.itemIds.length===0) throw domainFailure("version_conflict","editor.revision-feedback-required",null);
  if(!input.draft.text.trim() && input.draft.fileIds.length===0 || state.answers.some((answer):boolean=>answer.id===input.answerId || answer.attemptId===input.attemptId)) throw domainFailure("reference_conflict","editor.revision-content-identity",null);
  if(input.draft.text.trim()===parent.text.trim() && JSON.stringify([...input.draft.fileIds].sort())===JSON.stringify([...parent.fileIds].sort())) throw domainFailure("validation","editor.revision-change-required",null);
  const answer=tutorAnswer.parse({contentFingerprint:input.contentFingerprint,id:input.answerId,questionId:state.question.id,attemptId:input.attemptId,...input.draft,submittedAt:input.submittedAt,helped:true});
  const saved=editorVersion.parse({id:answer.id,parentId:parent.id,feedbackId:feedback.id,answerId:answer.id,attemptId:answer.attemptId,text:answer.text,fileIds:answer.fileIds,reason:input.reason,planVersionId:parent.planVersionId,unitVersion:parent.unitVersion,createdAt:answer.submittedAt});
  return tutorState.parse({...state,version:state.version+1,question:{...state.question,attemptId:answer.attemptId},answers:[...state.answers,answer],currentAnswerId:answer.id,draft:input.draft,editor:{...editor,phase:"revision-saved",versions:[...editor.versions,saved],currentVersionId:saved.id,draftReason:input.reason}});
}
