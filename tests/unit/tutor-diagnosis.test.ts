import { expect,it } from "vitest";
import { validateLearningOutput } from "../../lib/ai/learning-contract";
import { tutorContext } from "../../lib/tutor/ai";
import { tutorState } from "../../lib/tutor/contracts";
import type { TutorState } from "../../lib/tutor/contracts";
import { beginTutorHelp } from "../../lib/tutor/help";
import { publicTutorView } from "../../lib/tutor/view";
import { beginTutorVariation,tutorIndependentCandidate } from "../../lib/tutor/variation";
import { beginDirectTutorAnswer,saveTutorAnswer,beginTutorDiagnosis,finishTutorDiagnosis,reviseTutorAnswer } from "../../lib/tutor/state";
import { tutorStateFixture,tutorAnswerFixture,tutorDiagnosisFixture,tutorId } from "../fixtures/tutor-state";
import { resultFixture } from "../fixtures/result-state";
import { calculateResult,resultIssues } from "../../lib/results/evidence";

function pending():TutorState {return beginTutorDiagnosis(saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()),tutorAnswerFixture()));}
it("정답과 도움 필요를 동시에 반환한 AI 응답을 저장 전 거부한다",()=>{
  const state=pending();const before=JSON.stringify(state);const conflict={...tutorDiagnosisFixture(),needsHelp:true};
  expect(()=>finishTutorDiagnosis(state,conflict)).toThrow(expect.objectContaining({code:"reference_conflict"}));
  expect(()=>validateLearningOutput({result:conflict},"tutor-diagnosis",tutorContext(state))).toThrow(expect.objectContaining({code:"ai_semantic_invalid"}));
  expect(JSON.stringify(state)).toBe(before);
});
it("과거 모순 응답을 읽고 보존하되 도움과 새 과제는 재진단 전 차단한다",()=>{
  const state=finishTutorDiagnosis(pending(),tutorDiagnosisFixture());const conflict={...tutorDiagnosisFixture(),needsHelp:true};
  const legacy=tutorState.parse({...state,diagnosis:conflict,diagnoses:[conflict]});
  expect(publicTutorView(legacy).diagnosis).toEqual({...conflict,citations:[]});expect(legacy.diagnoses).toEqual([conflict]);expect(()=>beginTutorHelp(legacy)).toThrow();expect(()=>beginTutorVariation(legacy)).toThrow();
  const revised=reviseTutorAnswer(legacy,tutorId(88));expect(revised.answers).toEqual(legacy.answers);expect(revised.diagnoses).toEqual([conflict]);expect(revised.diagnosis).toBeNull();
});
it("과거 모순 응답은 독립 수행과 도움받아 수행 근거 모두에서 제외한다",()=>{
  const input=resultFixture();const states=input.states.map((state)=>({...state,diagnosis:state.diagnosis ? {...state.diagnosis,needsHelp:true} : null,diagnoses:state.diagnoses.map((diagnosis)=>({...diagnosis,needsHelp:true}))}));
  const result=calculateResult({...input,states,facts:input.facts.map((fact)=>({...fact,helpIds:JSON.stringify([tutorId(99)])}))});
  expect(result.performance).toBe("설명 필요");expect(result.unitPassed).toBe(false);expect(result.evidence.every((item)=>!item.accepted)).toBe(true);
  expect(tutorIndependentCandidate(states[0])).toBeNull();expect(resultIssues(states[0])).toContain(states[0].diagnoses[0].observation);
});
