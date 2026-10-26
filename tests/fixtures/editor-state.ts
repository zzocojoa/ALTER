import { submitEditorRevision } from "../../lib/editor/revision";
import { beginEditorReview,finishEditorReview } from "../../lib/editor/review";
import { editorResolvedFixture } from "./editor-output";
import { initialEditor,recordEditorDraft } from "../../lib/editor/state";
import { beginEditorFeedback,finishEditorFeedback } from "../../lib/editor/feedback";
import { saveTutorAnswer } from "../../lib/tutor/state";
import { tutorId,tutorStartFixture } from "./tutor-state";
import { editorFeedbackFixture } from "./editor-output";
import type { TutorState } from "../../lib/tutor/contracts";
export function editorWaitingFixture():TutorState {
  const initial=initialEditor(tutorId(11),tutorStartFixture(),tutorId(12),tutorId(13));
  const state=beginEditorFeedback(recordEditorDraft(saveTutorAnswer({...initial,draft:{text:"1/4은 네 조각",fileIds:[]}},{id:tutorId(14),questionId:initial.question.id,attemptId:initial.question.attemptId,text:"1/4은 네 조각",fileIds:[],submittedAt:1,helped:false})));
  return finishEditorFeedback(state,{id:tutorId(20),helpEventId:tutorId(21),helpAttemptId:tutorId(23),itemIds:[tutorId(22)],output:editorFeedbackFixture(state),committedAt:2});
}

export function editorReadyFixture():TutorState {
  const state=beginEditorReview(submitEditorRevision(editorWaitingFixture(),{answerId:tutorId(30),attemptId:tutorId(31),draft:{text:"같은 크기 네 조각 중 한 조각",fileIds:[]},reason:"전체와 부분 구분",submittedAt:3}));const output=editorResolvedFixture(state);
  return finishEditorReview(state,{id:tutorId(40),output,committedAt:4},{id:tutorId(41),helpEventId:tutorId(42),helpAttemptId:tutorId(43),itemIds:[],output:output.remaining,committedAt:4});
}
