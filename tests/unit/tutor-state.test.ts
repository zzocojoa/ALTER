import { describe, expect, it } from "vitest";
import { beginDirectTutorAnswer, beginTutorDiagnosis, beginTutorLesson, beginTutorRecall, finishTutorDiagnosis, finishTutorLesson, finishTutorSession, pauseTutor, resumeTutor, reviseTutorAnswer, saveTutorAnswer } from "../../lib/tutor/state";
import { tutorAnswerFixture, tutorDiagnosisFixture, tutorId, tutorLessonFixture, tutorStateFixture } from "../fixtures/tutor-state";

describe("Tutor 답안 우선 상태 전이", () => {
  it("설명부터 진단까지 순서대로 진행하고 입력 상태를 변경하지 않는다", () => {
    const original=tutorStateFixture(); const before=JSON.stringify(original); const pending=beginTutorLesson(original);
    const shown=finishTutorLesson(pending,tutorLessonFixture()); const hidden=beginTutorRecall(shown);
    const saved=saveTutorAnswer(hidden,tutorAnswerFixture()); const evaluated=finishTutorDiagnosis(beginTutorDiagnosis(saved),tutorDiagnosisFixture());
    expect(finishTutorSession(evaluated).phase).toBe("finished"); expect(JSON.stringify(original)).toBe(before); expect(evaluated.answers).toHaveLength(1);
  });
  it("설명 없이 직접 쓰기는 명시적 동작이며 미저장 답안 평가는 금지한다", () => {
    const original=tutorStateFixture(); expect(()=>beginTutorRecall(original)).toThrow(); expect(()=>beginTutorDiagnosis(original)).toThrow();
    const hidden=beginDirectTutorAnswer(original); expect(()=>beginTutorDiagnosis(hidden)).toThrow(); expect(()=>finishTutorSession(hidden)).toThrow();
    const stored=saveTutorAnswer(hidden,tutorAnswerFixture());expect(finishTutorSession(beginTutorDiagnosis(stored)).diagnosis).toBeNull();
    expect(()=>saveTutorAnswer(hidden,{...tutorAnswerFixture(),text:"  "})).toThrow();
    expect(()=>saveTutorAnswer(hidden,{...tutorAnswerFixture(),questionId:tutorId(99)})).toThrow();
  });
  it("없는 인용과 다른 답안에 대한 진단을 거부한다", () => {
    expect(()=>finishTutorLesson(beginTutorLesson(tutorStateFixture()),{...tutorLessonFixture(),explanation:{text:"추정",citations:[{sourceRefId:tutorId(7),quote:"없는 원문"}]}})).toThrow();
    const state=beginTutorDiagnosis(saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()),tutorAnswerFixture()));
    expect(()=>finishTutorDiagnosis(state,{...tutorDiagnosisFixture(),answerId:tutorId(99)})).toThrow();
    expect(()=>finishTutorDiagnosis(state,{...tutorDiagnosisFixture(),readability:"unreadable"})).toThrow();
    expect(finishTutorDiagnosis(state,{...tutorDiagnosisFixture(),readability:"unreadable",correct:null,needsHelp:true}).diagnosis?.correct).toBeNull();
  });
  it("일시정지 후 동일 질문을 재개하고 수정 이전의 늦은 진단은 적용하지 않는다", () => {
    const saved=saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()),tutorAnswerFixture()); const pending=beginTutorDiagnosis(saved);
    const paused=pauseTutor(pending); expect(()=>finishTutorDiagnosis(paused,tutorDiagnosisFixture())).toThrow();
    expect(resumeTutor(paused).question).toEqual(pending.question);
    const revised=reviseTutorAnswer(pending,tutorId(16)); expect(revised.answers).toEqual(pending.answers); expect(()=>finishTutorDiagnosis(revised,tutorDiagnosisFixture())).toThrow();
    const newPending=beginTutorDiagnosis(saveTutorAnswer(revised,{...tutorAnswerFixture(),id:tutorId(15),attemptId:tutorId(16)})); expect(()=>finishTutorDiagnosis(newPending,tutorDiagnosisFixture())).toThrow();
  });
});
