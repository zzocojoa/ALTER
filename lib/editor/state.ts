import { domainFailure } from "../domain/contracts.ts";
import { tutorState } from "../tutor/contracts.ts";
import type { TutorState } from "../tutor/contracts.ts";
import { initialTutor } from "../tutor/state.ts";
import type { TutorStartContext } from "../tutor/start.ts";
import { editorVersion } from "./contracts.ts";

export function initialEditor(id:string,start:TutorStartContext,questionId:string,attemptId:string):TutorState {
  const initial=initialTutor(id,start,questionId,attemptId);
  const question={...initial.question,mode:"practice" as const,prompt:start.bundle.exercise.text,sourceRefIds:start.bundle.exercise.sourceRefIds};
  return tutorState.parse({...initial,question,questions:[question],phase:"awaiting-answer",editor:{phase:"draft",versions:[],currentVersionId:null,draftReason:"",feedbacks:[],reviews:[]}});
}
/** 최초 초안도 실제 저장되는 답안과 동일한 식별자를 사용합니다. */
export function recordEditorDraft(state:TutorState):TutorState {
  const editor=state.editor;const answer=state.answers.at(-1);
  if(!editor || editor.phase!=="draft" || editor.versions.length!==0 || !answer || state.phase!=="answer-saved" || answer.id!==state.currentAnswerId) throw domainFailure("version_conflict","editor.initial-draft-required",null);
  const saved=editorVersion.parse({id:answer.id,parentId:null,feedbackId:null,answerId:answer.id,attemptId:answer.attemptId,text:answer.text,fileIds:answer.fileIds,reason:null,planVersionId:state.start.bundle.unit.planVersionId,unitVersion:state.start.bundle.unit.unitVersion,createdAt:answer.submittedAt});
  return tutorState.parse({...state,editor:{...editor,phase:"draft-saved",versions:[saved],currentVersionId:saved.id}});
}
