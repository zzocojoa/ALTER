import { beginTutorVariation } from "../../lib/tutor/variation";
import { validateLearningOutput } from "../../lib/ai/learning-contract";
import { tutorContext } from "../../lib/tutor/ai";
import { publicTutorView } from "../../lib/tutor/view";
import { TUTOR_DIRECTION_TEXT,TUTOR_DIRECTION_PROMPT } from "../../lib/tutor/direction";
import { expect,it } from "vitest";
import { beginTutorHelp,finishTutorHelp,requiredTutorHelpStage,currentTutorHelp } from "../../lib/tutor/help";
import { beginDirectTutorAnswer,saveTutorAnswer,beginTutorDiagnosis,finishTutorDiagnosis,reviseTutorAnswer } from "../../lib/tutor/state";
import { tutorStateFixture,tutorAnswerFixture,tutorDiagnosisFixture,tutorId,tutorLessonFixture } from "../fixtures/tutor-state";
import type { TutorState,TutorScaffold } from "../../lib/tutor/contracts";
function diagnosed():TutorState {return finishTutorDiagnosis(beginTutorDiagnosis(saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()),tutorAnswerFixture())),{...tutorDiagnosisFixture(),correct:false,needsHelp:true});}
it("도움 네 단계를 순서대로 제공하고 매번 새 답안·진단을 기다린다",()=>{
  let state=diagnosed();const stages=["direction","small-question","similar-example","full-explanation"] as const;
  for(let index=0;index<stages.length;index+=1){
    expect(requiredTutorHelpStage(state)).toBe(stages[index]);const pending=beginTutorHelp(state);
    const output:TutorScaffold={kind:"tutor-scaffold",questionId:state.question.id,answerId:state.currentAnswerId!,stage:stages[index],explanation:{...tutorLessonFixture().explanation,text:index===0 ? TUTOR_DIRECTION_TEXT : tutorLessonFixture().explanation.text},learnerPrompt:index===0 ? TUTOR_DIRECTION_PROMPT : "한 부분만 내 말로 설명해 주세요."};
    if(index<3) expect(()=>finishTutorHelp(pending,{...output,stage:"full-explanation"},tutorId(50+index),tutorId(60+index),10)).toThrow();
    state=finishTutorHelp(pending,output,tutorId(50+index),tutorId(60+index),10);expect(currentTutorHelp(state)?.stage).toBe(stages[index]);expect(()=>beginTutorHelp(state)).toThrow();
    const answer={...tutorAnswerFixture(),id:tutorId(70+index),attemptId:state.question.attemptId,submittedAt:10,helped:true};
    expect(()=>saveTutorAnswer(state,{...answer,helped:false})).toThrow();
    state=finishTutorDiagnosis(beginTutorDiagnosis(saveTutorAnswer(state,answer)),{...tutorDiagnosisFixture(),answerId:answer.id,correct:false,needsHelp:true});expect(currentTutorHelp(state)).toBeNull();
  }
  expect(()=>beginTutorHelp(state)).toThrow();expect(state.help).toHaveLength(4);expect(beginTutorVariation(state).pending?.kind).toBe("tutor-variation");expect(reviseTutorAnswer(state,tutorId(80)).help).toEqual(state.help);
});
it("도움 필요성이 없는 진단·오래된 답안·미저장 상태에서는 도움을 열지 않는다",()=>{
  const state=diagnosed();expect(()=>beginTutorHelp({...state,diagnosis:{...state.diagnosis!,needsHelp:false}})).toThrow();expect(()=>beginTutorHelp({...state,currentAnswerId:tutorId(99)})).toThrow();expect(()=>beginTutorHelp(tutorStateFixture())).toThrow();
});

it("방향 힌트의 정의·정답 노출을 거부하고 내부 출처 인용을 화면에 보내지 않는다",()=>{
  const pending=beginTutorHelp(diagnosed());
  const output:TutorScaffold={kind:"tutor-scaffold",questionId:pending.question.id,answerId:pending.currentAnswerId!,stage:"direction",explanation:{text:TUTOR_DIRECTION_TEXT,citations:tutorLessonFixture().explanation.citations},learnerPrompt:TUTOR_DIRECTION_PROMPT};
  expect(()=>finishTutorHelp(pending,{...output,explanation:{...output.explanation,text:"분모는 전체를 나눈 같은 크기 조각의 수이고, 분자는 선택한 조각의 수예요."}},tutorId(90),tutorId(91),10)).toThrow();
  expect(()=>validateLearningOutput({result:{...output,explanation:{...output.explanation,text:"정답 정의를 제공했습니다."}}},"tutor-scaffold",tutorContext(pending))).toThrow(expect.objectContaining({code:"ai_semantic_invalid"}));
  const state=finishTutorHelp(pending,output,tutorId(90),tutorId(91),10);
  expect(publicTutorView(state).help?.explanation.citations).toEqual([]);
  const historical={...state,help:state.help.map((help)=>({...help,explanation:{...help.explanation,text:"분모는 전체 조각 수입니다."}}))};
  expect(publicTutorView(historical).help?.explanation.text).toContain("정답 설명이 포함되어");expect(historical.help[0].explanation.text).toBe("분모는 전체 조각 수입니다.");
});
