import { domainFailure } from "../domain/contracts.ts";
import { tutorState } from "../tutor/contracts.ts";
import type { TutorState } from "../tutor/contracts.ts";
import { editorFeedbackRecord } from "./contracts.ts";
import type { EditorFeedbackRecord } from "./contracts.ts";
import { currentEditorVersion,validateEditorFeedback } from "./evidence.ts";

export function beginEditorFeedback(state:TutorState):TutorState {
  if(state.editor?.phase!=="draft-saved" || state.phase!=="answer-saved" || state.pending) throw domainFailure("version_conflict","editor.feedback-phase",null);
  currentEditorVersion(state);
  return tutorState.parse({...state,version:state.version+1,phase:"evaluating",pending:{key:`editor:${state.id}:${state.version}:feedback`,kind:"editor-draft-feedback"}});
}
/** 피드백 열람은 수정 제출이나 독립 수행의 증거가 아닙니다. */
export function finishEditorFeedback(state:TutorState,value:EditorFeedbackRecord):TutorState {
  const editor=state.editor;const record=editorFeedbackRecord.parse(value);
  if(!editor || state.pending?.kind!=="editor-draft-feedback" || state.phase!=="evaluating" || record.itemIds.length!==record.output.items.length || new Set(record.itemIds).size!==record.itemIds.length) throw domainFailure("version_conflict","editor.feedback-pending",null);
  validateEditorFeedback(state,record.output);
  return tutorState.parse({...state,version:state.version+1,phase:"answer-saved",pending:null,editor:{...editor,phase:record.output.items.length>0 ? "awaiting-revision" : "ready-for-recheck",feedbacks:[...editor.feedbacks,record]}});
}
