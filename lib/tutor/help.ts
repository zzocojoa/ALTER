import { hasTutorDiagnosisConflict } from "./diagnosis.ts";
import { domainFailure,recordId,timestamp } from "../domain/contracts.ts";
import { tutorHelpStage,tutorState } from "./contracts.ts";
import type { TutorHelpStage,TutorState,TutorScaffold } from "./contracts.ts";
import { validateTutorEvidence } from "./evidence.ts";

/** 도움 요청마다 앞선 단계 뒤에 실제 새 답안과 현재 진단이 있는지 검사합니다. */
export function requiredTutorHelpStage(state:TutorState):TutorHelpStage {
  if(hasTutorDiagnosisConflict(state.diagnosis) || state.phase!=="diagnosed" || !state.currentAnswerId || !state.diagnosis?.needsHelp || state.diagnosis.answerId!==state.currentAnswerId || state.diagnosis.questionId!==state.question.id) throw domainFailure("version_conflict","tutor.help-current-diagnosis-required",null);
  const history=state.help.filter((item):boolean=>item.questionId===state.question.id);
  const previous=history.at(-1);const answerIndex=state.answers.findIndex((answer):boolean=>answer.id===state.currentAnswerId);
  if(answerIndex<0 || previous && answerIndex<=state.answers.findIndex((answer):boolean=>answer.id===previous.answerId)) throw domainFailure("reference_conflict","tutor.help-new-performance-required",null);
  const stage=tutorHelpStage.options[history.length];
  if(!stage || history.some((item,index):boolean=>item.stage!==tutorHelpStage.options[index])) throw domainFailure("reference_conflict","tutor.help-order-exhausted",null);
  return stage;
}
export function beginTutorHelp(state:TutorState):TutorState {
  requiredTutorHelpStage(state);if(state.pending) throw domainFailure("version_conflict","tutor.help-already-pending",null);
  return tutorState.parse({...state,version:state.version+1,pending:{key:`tutor:${state.id}:${state.version}:help`,kind:"tutor-scaffold"}});
}
/** 이 전이는 저장 명세일 뿐이며 저장 성공 전에는 도움 본문을 전달하지 않습니다. */
export function finishTutorHelp(state:TutorState,output:TutorScaffold,id:string,attemptId:string,now:number):TutorState {
  if(state.pending?.kind!=="tutor-scaffold" || output.stage!==requiredTutorHelpStage(state)) throw domainFailure("reference_conflict","tutor.help-expected-stage",null);
  validateTutorEvidence(state,output);timestamp.parse(now);
  const question={...state.question,attemptId:recordId.parse(attemptId)};
  if(state.answers.some((answer):boolean=>answer.attemptId===question.attemptId)) throw domainFailure("reference_conflict","tutor.help-new-attempt-required",null);
  return tutorState.parse({...state,version:state.version+1,phase:"awaiting-answer",pending:null,currentAnswerId:null,diagnosis:null,draft:{text:"",fileIds:[]},question,questions:state.questions.map((item)=>item.id===question.id ? question : item),help:[...state.help,{id:recordId.parse(id),questionId:state.question.id,answerId:output.answerId,stage:output.stage,explanation:output.explanation,learnerPrompt:output.learnerPrompt,committedAt:now,deliveredAt:null}]});
}
export function currentTutorHelp(state:TutorState):TutorState["help"][number]|null {
  const help=state.help.filter((item):boolean=>item.questionId===state.question.id).at(-1);if(!help) return null;
  const answeredIndex=state.answers.findIndex((answer):boolean=>answer.id===help.answerId);
  return state.answers.some((answer,index):boolean=>index>answeredIndex && answer.questionId===state.question.id) ? null : help;
}
