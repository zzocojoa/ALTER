import { beginDirectTutorAnswer,saveTutorAnswer,beginTutorDiagnosis,finishTutorDiagnosis } from "../../lib/tutor/state";
import { beginTutorVariation,finishTutorVariation } from "../../lib/tutor/variation";
import { tutorStateFixture,tutorAnswerFixture,tutorDiagnosisFixture,tutorId,tutorLessonFixture } from "./tutor-state";
import type { JudgmentInput,AnswerFact } from "../../lib/results/evidence";
export function resultFixture():JudgmentInput {
  const answer={...tutorAnswerFixture(),contentFingerprint:"a".repeat(64)};
  const explained=finishTutorDiagnosis(beginTutorDiagnosis(saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()),answer)),tutorDiagnosisFixture());
  const pending=beginTutorVariation(explained);const varied=finishTutorVariation(pending,{kind:"tutor-variation",originalQuestionId:pending.question.id,prompt:"같은 크기 다섯 조각 중 둘을 분수로 쓰세요.",changedCondition:{before:pending.question.prompt,after:"다섯 조각 중 둘",reason:"새 상황에 적용"},citations:tutorLessonFixture().explanation.citations},tutorId(80),tutorId(81));
  const newAnswer={...answer,id:tutorId(82),questionId:varied.question.id,attemptId:varied.question.attemptId,text:"2/5",submittedAt:2,contentFingerprint:"b".repeat(64)};
  const state=finishTutorDiagnosis(beginTutorDiagnosis(saveTutorAnswer(varied,newAnswer)),{...tutorDiagnosisFixture(),questionId:newAnswer.questionId,answerId:newAnswer.id});
  const facts:AnswerFact[]=state.answers.map((item,index)=>({id:item.id,sessionId:state.id,questionId:item.questionId,attemptId:item.attemptId,version:2,attemptVersion:2,text:item.text,mode:index===0 ? "initial" : "new-condition",hidden:1,status:"ready",answerEventVersion:index===0 ? 3 : 8,exposureVersion:index===0 ? 2 : 7,diagnosisVersion:index===0 ? 5 : 10,helpIds:"[]",variation:index===0 ? null : JSON.stringify(state.variations[0])}));
  return {states:[state],facts,planVersionId:state.start.bundle.unit.planVersionId,unitVersion:1,correctionRequired:false,invalidSourceIds:[],delayed:[]};
}
