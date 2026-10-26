import { tutorIndependentCandidate } from "../tutor/variation.ts";
import { validateEditorHistory } from "./history.ts";
import { z } from "zod";
import { domainFailure,recordId,timestamp } from "../domain/contracts.ts";
import { tutorView,publicTutorView } from "../tutor/view.ts";
import type { TutorState } from "../tutor/contracts.ts";
import { editorVersion,editorState,editorBasis,editorIssue,editorLocation } from "./contracts.ts";
const feedbackView=z.object({needsRecheck:z.boolean(),id:recordId,versionId:recordId,basis:z.array(editorBasis),items:z.array(editorIssue.omit({citations:true}).extend({sourceRefIds:z.array(recordId)})),committedAt:timestamp}).strict();
const reviewView=z.object({id:recordId,versionId:recordId,feedbackId:recordId,outcome:z.enum(["needs-revision","ready-for-recheck"]),checks:z.array(z.object({itemId:recordId,resolved:z.boolean(),revisionLocation:editorLocation,reasonQuote:z.string()})),needsRecheck:z.boolean()}).strict();
export const editorView=z.object({tutor:tutorView,phase:editorState.shape.phase,versions:z.array(editorVersion),feedbacks:z.array(feedbackView),reviews:z.array(reviewView),draftReason:z.string(),historyHidden:z.boolean(),transfer:z.object({question:z.string(),answer:z.string(),photoCount:z.number().int().nonnegative(),helped:z.boolean(),correct:z.boolean().nullable(),candidate:z.boolean(),observation:z.string().nullable()}).strict().nullable()}).strict();
export type EditorView=Readonly<z.infer<typeof editorView>>;
/** 새 조건을 풀 때에는 원과제·수정본·피드백 본문도 응답에 포함하지 않습니다. */
export function publicEditorView(state:TutorState):EditorView {
  if(!state.editor) throw domainFailure("reference_conflict","editor.session-required",null);
  validateEditorHistory(state);
  const hidden=state.editor.phase==="variation" && state.phase!=="finished";
  const answer=state.answers.find((item)=>item.id===state.currentAnswerId);const diagnosis=state.diagnosis;
  const transfer=state.editor.phase==="variation" && answer && state.phase!=="paused" ? {question:state.question.prompt,answer:answer.text,photoCount:answer.fileIds.length,helped:answer.helped,correct:diagnosis?.correct ?? null,candidate:tutorIndependentCandidate(state)!==null,observation:diagnosis?.observation ?? null} : null;
  return editorView.parse({tutor:publicTutorView(state),phase:state.editor.phase,versions:hidden ? [] : state.editor.versions,feedbacks:hidden ? [] : state.editor.feedbacks.map((feedback)=>({needsRecheck:false,id:feedback.id,versionId:feedback.output.versionId,basis:feedback.output.basis,items:feedback.output.items.map((item)=>({basisIndex:item.basisIndex,issue:item.issue,direction:item.direction,sourceRefIds:item.citations.map((citation)=>citation.sourceRefId)})),committedAt:feedback.committedAt})),reviews:hidden ? [] : state.editor.reviews.map((review)=>({id:review.id,versionId:review.output.versionId,feedbackId:review.output.feedbackId,outcome:review.output.outcome,checks:review.output.checks,needsRecheck:false})),draftReason:hidden ? "" : state.editor.draftReason,historyHidden:hidden,transfer});
}
