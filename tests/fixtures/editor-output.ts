import type { TutorState } from "../../lib/tutor/contracts";
import { editorFeedbackOutput,editorReviewOutput } from "../../lib/editor/contracts";
import type { EditorFeedbackOutput,EditorReviewOutput } from "../../lib/editor/contracts";
import { currentEditorVersion } from "../../lib/editor/evidence";
export function editorFeedbackFixture(state:TutorState):EditorFeedbackOutput {
  const draft=currentEditorVersion(state);const source=state.start.bundle.sources[0];
  return editorFeedbackOutput.parse({kind:"editor-draft-feedback",versionId:draft.id,answerId:draft.answerId,verdict:"issues-found",basis:[{location:{kind:"text",start:0,end:Array.from(draft.text).length,quote:draft.text},criterion:"self-explanation",criterionQuote:state.start.bundle.unit.selfExplanationCriterion}],items:[{basisIndex:0,issue:"definition",direction:"check-definition",citations:[{sourceRefId:source.id,quote:source.evidence}]}]});
}

export function editorNeedsRevisionFixture(state:TutorState):EditorReviewOutput {
  const draft=currentEditorVersion(state);const feedback=state.editor?.feedbacks.find((item)=>item.id===draft.feedbackId);if(!feedback || !draft.reason) throw new Error("재평가 시험 입력 없음");
  return editorReviewOutput.parse({kind:"editor-revision-review",versionId:draft.id,answerId:draft.answerId,feedbackId:feedback.id,outcome:"needs-revision",checks:feedback.itemIds.map((itemId)=>({itemId,resolved:false,revisionLocation:{kind:"text",start:0,end:Array.from(draft.text).length,quote:draft.text},reasonQuote:draft.reason})),remaining:editorFeedbackFixture(state)});
}
export function editorResolvedFixture(state:TutorState):EditorReviewOutput {
  const value=editorNeedsRevisionFixture(state);
  return editorReviewOutput.parse({...value,outcome:"ready-for-recheck",checks:value.checks.map((item)=>({...item,resolved:true})),remaining:{...value.remaining,items:[],verdict:"no-issue-evidenced"}});
}
