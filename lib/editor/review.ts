import { finishTutorSession } from "../tutor/state.ts";
import { domainFailure } from "../domain/contracts.ts";
import { tutorState } from "../tutor/contracts.ts";
import type { TutorState } from "../tutor/contracts.ts";
import { editorFeedbackRecord,editorReviewRecord } from "./contracts.ts";
import type { EditorReviewOutput,EditorReviewRecord,EditorFeedbackRecord } from "./contracts.ts";
import { currentEditorVersion,validateEditorFeedback } from "./evidence.ts";
export function validateEditorReviewEvidence(state:TutorState,output:EditorReviewOutput):void {
  const draft=currentEditorVersion(state);const feedback=state.editor?.feedbacks.find((item)=>item.id===draft.feedbackId);
  if(!draft.reason?.trim() || !draft.parentId || !feedback || output.versionId!==draft.id || output.answerId!==draft.answerId || output.feedbackId!==feedback.id || output.checks.length!==feedback.itemIds.length || new Set(output.checks.map((item)=>item.itemId)).size!==output.checks.length) throw domainFailure("reference_conflict","editor.review-revision-reason-feedback",null);
  for(const check of output.checks){
    if(!feedback.itemIds.includes(check.itemId) || !draft.reason.includes(check.reasonQuote)) throw domainFailure("reference_conflict","editor.review-exact-reason",null);
    const location=check.revisionLocation;
    if(location.kind==="text" ? location.end<=location.start || location.end>Array.from(draft.text).length || Array.from(draft.text).slice(location.start,location.end).join("")!==location.quote : !draft.fileIds.includes(location.fileId) || location.right<=location.left || location.bottom<=location.top) throw domainFailure("reference_conflict","editor.review-actual-revision",null);
  }
  validateEditorFeedback(state,output.remaining);
  const ready=output.checks.every((item)=>item.resolved) && output.remaining.items.length===0;
  if((output.outcome==="ready-for-recheck")!==ready || output.outcome==="needs-revision" && output.remaining.items.length===0) throw domainFailure("reference_conflict","editor.review-outcome-evidence",null);
}
export function beginEditorReview(state:TutorState):TutorState {
  if(state.editor?.phase!=="revision-saved" || state.phase!=="answer-saved" || state.pending) throw domainFailure("version_conflict","editor.review-phase",null);
  const draft=currentEditorVersion(state);if(!draft.reason || !draft.feedbackId) throw domainFailure("reference_conflict","editor.review-reason-required",null);
  return tutorState.parse({...state,version:state.version+1,phase:"evaluating",pending:{key:`editor:${state.id}:${state.version}:review`,kind:"editor-revision-review"}});
}
/** 수정본의 개선 판정과 독립 수행은 별도의 증거로 다룹니다. */
export function finishEditorReview(state:TutorState,value:EditorReviewRecord,feedbackValue:EditorFeedbackRecord):TutorState {
  const editor=state.editor;const review=editorReviewRecord.parse(value);const feedback=editorFeedbackRecord.parse(feedbackValue);
  if(!editor || state.phase!=="evaluating" || state.pending?.kind!=="editor-revision-review" || JSON.stringify(review.output.remaining)!==JSON.stringify(feedback.output) || feedback.itemIds.length!==feedback.output.items.length) throw domainFailure("version_conflict","editor.review-pending",null);
  validateEditorReviewEvidence(state,review.output);
  return tutorState.parse({...state,version:state.version+1,phase:"answer-saved",pending:null,editor:{...editor,phase:review.output.outcome==="ready-for-recheck" ? "ready-for-recheck" : "awaiting-revision",reviews:[...editor.reviews,review],feedbacks:[...editor.feedbacks,feedback]}});
}

/** 결과 확인을 닫아도 전송한 요청의 비용과 저장된 답안은 취소하지 않습니다. */
export function cancelEditorEvaluation(state:TutorState):TutorState {
  if(!state.editor || state.phase!=="evaluating" || !state.pending || !["editor-draft-feedback","editor-revision-review"].includes(state.pending.kind)) throw domainFailure("version_conflict","editor.cancel-pending-required",null);
  return tutorState.parse({...state,version:state.version+1,phase:"answer-saved",pending:null});
}

/** 미확정 첨삭을 보관하여 추가 유료 호출 없이 회차를 종료합니다. */
export function finishEditorSession(state:TutorState):TutorState {
  if(!state.editor || state.pending || state.phase!=="answer-saved") throw domainFailure("version_conflict","editor.finish-saved-result-required",null);
  return finishTutorSession(state);
}
