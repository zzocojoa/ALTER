import { expect,it } from "vitest";
import { beginTutorVariation,finishTutorVariation,tutorIndependentCandidate } from "../../lib/tutor/variation";
import { beginDirectTutorAnswer,saveTutorAnswer,beginTutorDiagnosis,finishTutorDiagnosis } from "../../lib/tutor/state";
import { tutorStateFixture,tutorAnswerFixture,tutorDiagnosisFixture,tutorId,tutorLessonFixture } from "../fixtures/tutor-state";
import type { TutorState,TutorVariation } from "../../lib/tutor/contracts";
function ready():TutorState {return finishTutorDiagnosis(beginTutorDiagnosis(saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()),tutorAnswerFixture())),tutorDiagnosisFixture());}
function output(state:TutorState):TutorVariation {return {kind:"tutor-variation",originalQuestionId:state.question.id,prompt:"같은 크기 다섯 조각 중 둘을 분수로 쓰세요.",changedCondition:{before:state.question.prompt,after:"다섯 조각 중 둘",reason:"개념 설명을 새 조각 상황에 적용"},citations:tutorLessonFixture().explanation.citations};}
it("새 문제·새 시도의 실제 무도움 답안만 독립 수행 근거 후보가 된다",()=>{
  const original=ready();expect(tutorIndependentCandidate(original)).toBeNull();const pending=beginTutorVariation(original);const next=finishTutorVariation(pending,output(pending),tutorId(80),tutorId(81));
  expect(next.question.originalQuestionId).toBe(original.question.id);expect(next.answers).toEqual(original.answers);expect(tutorIndependentCandidate(next)).toBeNull();
  const answer={...tutorAnswerFixture(),text:"다섯 조각 중 둘은 2/5입니다.",id:tutorId(82),questionId:next.question.id,attemptId:next.question.attemptId};
  const complete=finishTutorDiagnosis(beginTutorDiagnosis(saveTutorAnswer(next,answer)),{...tutorDiagnosisFixture(),questionId:answer.questionId,answerId:answer.id});
  expect(tutorIndependentCandidate(complete)).toBe(answer.id);expect(tutorIndependentCandidate({...complete,answers:complete.answers.map((item)=>({...item,helped:true}))})).toBeNull();
});
it("답변 없는 전이·조건 없는 재출제·원문제 ID 재사용은 거부한다",()=>{
  expect(()=>beginTutorVariation(tutorStateFixture())).toThrow();const pending=beginTutorVariation(ready());const value=output(pending);
  expect(()=>finishTutorVariation(pending,{...value,prompt:pending.question.prompt},tutorId(80),tutorId(81))).toThrow();
  expect(()=>finishTutorVariation(pending,{...value,changedCondition:{...value.changedCondition,after:value.changedCondition.before}},tutorId(80),tutorId(81))).toThrow();
  expect(()=>finishTutorVariation(pending,value,pending.question.id,tutorId(81))).toThrow();
});
