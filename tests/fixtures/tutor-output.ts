import { TUTOR_DIRECTION_TEXT,TUTOR_DIRECTION_PROMPT } from "../../lib/tutor/direction";
import { requiredTutorHelpStage } from "../../lib/tutor/help";
import { domainFailure } from "../../lib/domain/contracts";
import type { TutorOutput,TutorState } from "../../lib/tutor/contracts";
export function tutorOutputFixture(state:TutorState):TutorOutput {
  const source=state.start.bundle.sources[0];const citations=[{sourceRefId:source.id,quote:source.evidence}];
  if(state.pending?.kind==="tutor-lesson") return {kind:"tutor-lesson",explanation:{text:"작은 개념에 대한 모의 설명입니다.",citations}};
  if(state.pending?.kind==="tutor-variation") return {kind:"tutor-variation",originalQuestionId:state.question.id,prompt:"같은 크기 다섯 조각 중 둘을 분수로 쓰세요.",changedCondition:{before:state.question.prompt,after:"다섯 조각 중 둘",reason:"개념을 새 상황에 적용"},citations};
  if(state.pending?.kind==="tutor-scaffold" && state.currentAnswerId) return {kind:"tutor-scaffold",questionId:state.question.id,answerId:state.currentAnswerId,stage:requiredTutorHelpStage(state),explanation:{text:requiredTutorHelpStage(state)==="direction" ? TUTOR_DIRECTION_TEXT : "한 단계 도움 모의 내용",citations},learnerPrompt:requiredTutorHelpStage(state)==="direction" ? TUTOR_DIRECTION_PROMPT : "지금 생각한 내용을 한 문장으로 써 주세요."};
  const needsHelp=state.answers.find((answer)=>answer.id===state.currentAnswerId)?.text.includes("모르겠습니다") ?? false;
  if(state.pending?.kind==="tutor-diagnosis" && state.currentAnswerId) return {kind:"tutor-diagnosis",questionId:state.question.id,answerId:state.currentAnswerId,readability:"readable",correct:!needsHelp,observation:"저장된 답안의 모의 진단입니다.",citations,needsHelp};
  throw domainFailure("validation","tutor.fixture-output-kind",null);
}
