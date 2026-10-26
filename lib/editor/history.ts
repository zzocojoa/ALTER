import { domainFailure } from "../domain/contracts.ts";
import type { TutorState } from "../tutor/contracts.ts";
import type { EditorFeedbackRecord } from "./contracts.ts";
export function validateEditorHistory(state:TutorState):void {
  const editor=state.editor;if(!editor) throw domainFailure("reference_conflict","editor.history-required",null);
  const ids=editor.versions.map((item)=>item.id);const feedbackIds=editor.feedbacks.map((item)=>item.id);
  if(new Set(ids).size!==ids.length || new Set(feedbackIds).size!==feedbackIds.length || editor.currentVersionId!==(editor.versions.at(-1)?.id ?? null)) throw domainFailure("reference_conflict","editor.history-unique-current",null);
  editor.versions.forEach((item,index):void=>{
    const answer=state.answers.find((value)=>value.id===item.answerId);
    if(!answer || item.id!==answer.id || item.attemptId!==answer.attemptId || item.text!==answer.text || JSON.stringify(item.fileIds)!==JSON.stringify(answer.fileIds) || item.planVersionId!==state.start.bundle.unit.planVersionId || item.unitVersion!==state.start.bundle.unit.unitVersion) throw domainFailure("reference_conflict","editor.history-saved-answer-criterion",null);
    if(index===0){if(item.parentId!==null || item.feedbackId!==null || item.reason!==null) throw domainFailure("reference_conflict","editor.history-root",null);return;}
    const parent=editor.versions[index-1];const feedback=editor.feedbacks.find((value)=>value.id===item.feedbackId);
    if(item.parentId!==parent.id || !item.reason?.trim() || !feedback || feedback.output.versionId!==parent.id || feedback.output.answerId!==parent.answerId || item.createdAt<parent.createdAt) throw domainFailure("reference_conflict","editor.history-parent-feedback-reason",null);
  });
  for(const feedback of editor.feedbacks){const target=editor.versions.find((item)=>item.id===feedback.output.versionId);if(!target || target.answerId!==feedback.output.answerId || feedback.committedAt<target.createdAt) throw domainFailure("reference_conflict","editor.history-feedback-target",null);}
  for(const review of editor.reviews){const target=editor.versions.find((item)=>item.id===review.output.versionId);if(!target || !target.reason || target.feedbackId!==review.output.feedbackId || target.answerId!==review.output.answerId || !editor.feedbacks.some((feedback)=>feedback.id===target.feedbackId) || review.committedAt<target.createdAt) throw domainFailure("reference_conflict","editor.history-review-target",null);}

}
export type EditorRecheck=Readonly<{feedbackId:string;reason:"source-changed"|"criterion-changed"|"result-corrected"|null}>;
export function feedbackSourceIds(state:TutorState,feedback:EditorFeedbackRecord):readonly string[] {
  return feedback.output.items.length>0 ? [...new Set(feedback.output.items.flatMap((item)=>item.citations.map((citation)=>citation.sourceRefId)))] : state.start.bundle.sources.map((source)=>source.id);
}
/** 원래 피드백과 노출 사건은 수정하지 않고 영향을 받는 근거만 별도로 표시합니다. */
export function editorFeedbackRechecks(state:TutorState,invalidSourceIds:readonly string[],criterionChanged:boolean,currentCorrectionId:string|null):readonly EditorRecheck[] {
  validateEditorHistory(state);
  return state.editor!.feedbacks.map((feedback)=>({feedbackId:feedback.id,reason:criterionChanged ? "criterion-changed" : currentCorrectionId!==(state.start.latest?.correctionId ?? null) ? "result-corrected" : feedbackSourceIds(state,feedback).some((id)=>invalidSourceIds.includes(id)) ? "source-changed" : null}));
}
