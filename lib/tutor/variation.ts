import { hasTutorDiagnosisConflict } from "./diagnosis.ts";
import { repeatsPreviousAnswer } from "./identity.ts";
import { currentEditorVersion } from "../editor/evidence.ts";
import { domainFailure,recordId } from "../domain/contracts.ts";
import { tutorState } from "./contracts.ts";
import type { TutorState,TutorVariation } from "./contracts.ts";
import { validateTutorEvidence } from "./evidence.ts";

export function requireTutorVariation(state:TutorState):void {
  if(state.editor?.phase==="ready-for-recheck") {
    const draft=currentEditorVersion(state);const feedback=state.editor.feedbacks.at(-1);const review=state.editor.reviews.at(-1);
    if(state.phase!=="answer-saved" || !feedback || feedback.output.versionId!==draft.id || feedback.output.items.length!==0 || draft.parentId!==null && (!review || review.output.versionId!==draft.id || review.output.outcome!=="ready-for-recheck")) throw domainFailure("reference_conflict","editor.variation-reviewed-version-required",null);
    return;
  }
  const fullExplanation=state.help.some((help):boolean=>help.questionId===state.question.id && help.stage==="full-explanation");
  if(hasTutorDiagnosisConflict(state.diagnosis) || state.phase!=="diagnosed" || !state.currentAnswerId || state.diagnosis?.answerId!==state.currentAnswerId || state.diagnosis.readability!=="readable" || !state.diagnosis.correct && !fullExplanation) throw domainFailure("reference_conflict","tutor.variation-saved-performance-required",null);
}
export function beginTutorVariation(state:TutorState):TutorState {
  requireTutorVariation(state);if(state.pending) throw domainFailure("version_conflict","tutor.variation-pending",null);
  return tutorState.parse({...state,version:state.version+1,pending:{key:`tutor:${state.id}:${state.version}:variation`,kind:"tutor-variation"}});
}
/** 조건 변경 근거가 명시된 별도 질문만 생성하고 원문제의 도움 사건을 보존합니다. */
export function finishTutorVariation(state:TutorState,output:TutorVariation,questionId:string,attemptId:string):TutorState {
  requireTutorVariation(state);if(state.pending?.kind!=="tutor-variation") throw domainFailure("version_conflict","tutor.variation-request",null);
  validateTutorEvidence(state,output);
  const question={id:recordId.parse(questionId),attemptId:recordId.parse(attemptId),originalQuestionId:state.question.originalQuestionId ?? state.question.id,mode:"new-condition" as const,prompt:output.prompt,sourceRefIds:[...new Set(output.citations.map((cite)=>cite.sourceRefId))]};
  if(state.questions.some((known):boolean=>known.id===question.id || known.attemptId===question.attemptId)) throw domainFailure("reference_conflict","tutor.variation-distinct-identity",null);
  return tutorState.parse({...state,...(state.editor ? {editor:{...state.editor,phase:"variation"}} : {}),version:state.version+1,phase:"awaiting-answer",question,questions:[...state.questions,question],currentAnswerId:null,diagnosis:null,pending:null,draft:{text:"",fileIds:[]},variations:[...state.variations,{questionId:question.id,parentQuestionId:state.question.id,helpEventIds:[...state.help.filter((help):boolean=>help.questionId===state.question.id).map((help)=>help.id),...(state.editor?.phase==="ready-for-recheck" ? state.editor.feedbacks.map((feedback)=>feedback.helpEventId) : [])],change:output.changedCondition}]});
}
/** 이 결과는 후속 평가의 근거 후보이며 확정 수행 수준을 갱신하지 않습니다. */
export function tutorIndependentCandidate(state:TutorState):string|null {
  if(hasTutorDiagnosisConflict(state.diagnosis) || !["diagnosed","finished"].includes(state.phase) || state.question.mode!=="new-condition" || state.diagnosis?.readability!=="readable" || state.diagnosis.correct!==true || state.diagnosis.answerId!==state.currentAnswerId || state.help.some((help):boolean=>help.questionId===state.question.id)) return null;
  const answer=state.answers.find((item):boolean=>item.id===state.currentAnswerId && item.questionId===state.question.id && !item.helped);
  return answer && !repeatsPreviousAnswer(answer,state.answers) ? answer.id : null;
}
