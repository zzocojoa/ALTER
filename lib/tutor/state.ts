import { domainFailure, recordId } from "../domain/contracts.ts";
import { tutorState, tutorAnswer, tutorDraft } from "./contracts.ts";
import type { TutorState, TutorQuestion, TutorAnswer, TutorLesson, TutorDiagnosis, TutorDraft } from "./contracts.ts";
import { validateTutorEvidence } from "./evidence.ts";
import type { TutorStartContext } from "./start.ts";

export function initialTutor(id: string, start: TutorStartContext, questionId: string, attemptId: string): TutorState {
  const question: TutorQuestion = { id: recordId.parse(questionId),attemptId: recordId.parse(attemptId),originalQuestionId: null,mode: "self-explanation",prompt: start.bundle.question.text,sourceRefIds: start.bundle.question.sourceRefIds };
  return tutorState.parse({ id,version: 1,draft:{text:"",fileIds:[]},variations:[],start,phase: "explanation",resumePhase: null,question,questions:[question],answers:[],currentAnswerId:null,lesson:null,diagnosis:null,diagnoses:[],help:[],pending:null });
}
export function beginTutorLesson(state: TutorState): TutorState {
  if (state.phase!=="explanation" || state.lesson || state.pending) throw domainFailure("version_conflict","tutor.lesson-phase",null);
  return tutorState.parse({...state,version:state.version+1,pending:{key:`tutor:${state.id}:${state.version}:lesson`,kind:"tutor-lesson"}});
}
export function finishTutorLesson(state: TutorState, output: TutorLesson): TutorState {
  if (state.phase!=="explanation" || state.pending?.kind!=="tutor-lesson") throw domainFailure("version_conflict","tutor.lesson-result-phase",null);
  validateTutorEvidence(state, output);
  return tutorState.parse({...state,version:state.version+1,lesson:output.explanation,pending:null});
}
export function beginTutorRecall(state: TutorState): TutorState {
  if (state.phase!=="explanation" || !state.lesson || state.pending) throw domainFailure("version_conflict","tutor.recall-phase",null);
  return tutorState.parse({...state,version:state.version+1,phase:"awaiting-answer"});
}
/** AI를 사용할 수 없을 때도 사용자가 선택한 직접 작성은 별도 사건으로 저장합니다. */
export function beginDirectTutorAnswer(state: TutorState): TutorState {
  if (state.phase!=="explanation") throw domainFailure("version_conflict","tutor.direct-answer-phase",null);
  return tutorState.parse({...state,version:state.version+1,phase:"awaiting-answer",pending:null});
}
export function saveTutorAnswer(state: TutorState, value: TutorAnswer): TutorState {
  const answer: TutorAnswer=tutorAnswer.parse(value);
  if (state.phase!=="awaiting-answer" || state.pending || answer.questionId!==state.question.id || answer.attemptId!==state.question.attemptId || state.answers.some((old):boolean=>old.id===answer.id)) throw domainFailure("version_conflict","tutor.answer-current-question",null);
  const helped: boolean=state.help.some((event):boolean=>event.questionId===state.question.id);
  if (helped && !answer.helped) throw domainFailure("reference_conflict","tutor.answer-help-history",null);
  return tutorState.parse({...state,version:state.version+1,phase:"answer-saved",answers:[...state.answers,answer],currentAnswerId:answer.id,diagnosis:null});
}
export function beginTutorDiagnosis(state: TutorState): TutorState {
  if (state.phase!=="answer-saved" || !state.currentAnswerId || state.pending || !state.answers.some((answer):boolean=>answer.id===state.currentAnswerId && answer.questionId===state.question.id)) throw domainFailure("version_conflict","tutor.diagnosis-saved-answer-required",null);
  return tutorState.parse({...state,version:state.version+1,phase:"evaluating",pending:{key:`tutor:${state.id}:${state.version}:diagnosis`,kind:"tutor-diagnosis"}});
}
export function finishTutorDiagnosis(state: TutorState, output: TutorDiagnosis): TutorState {
  if (state.phase!=="evaluating" || state.pending?.kind!=="tutor-diagnosis" || output.answerId!==state.currentAnswerId || output.questionId!==state.question.id || output.readability==="unreadable" && (output.correct!==null || !output.needsHelp)) throw domainFailure("reference_conflict","tutor.diagnosis-current-answer",null);
  validateTutorEvidence(state, output);
  return tutorState.parse({...state,version:state.version+1,phase:"diagnosed",pending:null,diagnosis:output,diagnoses:[...state.diagnoses,output]});
}
/** 새 답을 쓰더라도 이전 답안·진단·도움 사건은 보존하며 도착이 늦은 평가를 적용하지 않습니다. */
export function reviseTutorAnswer(state: TutorState, attemptId: string): TutorState {
  if (!["answer-saved","evaluating","diagnosed"].includes(state.phase)) throw domainFailure("version_conflict","tutor.revise-phase",null);
  return tutorState.parse({...state,version:state.version+1,phase:"awaiting-answer",question:{...state.question,attemptId:recordId.parse(attemptId)},pending:null,currentAnswerId:null,diagnosis:null});
}
export function pauseTutor(state: TutorState): TutorState {
  if (state.phase==="paused" || state.phase==="finished") throw domainFailure("version_conflict","tutor.pause-phase",null);
  return tutorState.parse({...state,version:state.version+1,phase:"paused",resumePhase:state.phase});
}
export function resumeTutor(state: TutorState): TutorState {
  if (state.phase!=="paused" || state.resumePhase===null) throw domainFailure("version_conflict","tutor.resume-phase",null);
  return tutorState.parse({...state,version:state.version+1,phase:state.resumePhase,resumePhase:null});
}
export function finishTutorSession(state: TutorState): TutorState {
  if (!["answer-saved","evaluating","diagnosed"].includes(state.phase) || !state.currentAnswerId) throw domainFailure("version_conflict","tutor.finish-phase",null);
  return tutorState.parse({...state,version:state.version+1,phase:"finished",pending:null});
}

export function saveTutorDraft(state:TutorState,value:TutorDraft):TutorState {
  if(state.phase!=="awaiting-answer" || state.pending) throw domainFailure("version_conflict","tutor.draft-phase",null);
  const draft=tutorDraft.parse(value);
  if(new Set(draft.fileIds).size!==draft.fileIds.length) throw domainFailure("validation","tutor.duplicate-files",null);
  return tutorState.parse({...state,version:state.version+1,draft});
}
