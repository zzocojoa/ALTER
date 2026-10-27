import type { TutorState, TutorScaffold } from "../../lib/tutor/contracts";
import { tutorHelpStage } from "../../lib/tutor/contracts";
import { beginDirectTutorAnswer, saveTutorAnswer, beginTutorDiagnosis, finishTutorDiagnosis } from "../../lib/tutor/state";
import { beginTutorHelp, finishTutorHelp } from "../../lib/tutor/help";
import { TUTOR_DIRECTION_TEXT, TUTOR_DIRECTION_PROMPT } from "../../lib/tutor/direction";
import { tutorStateFixture, tutorAnswerFixture, tutorDiagnosisFixture, tutorLessonFixture, tutorId } from "./tutor-state";

/** 실제 단계 전이로 합성 도움 이력을 만들며 모델 호출 없이 저장 결과만 제공합니다. */
export function tutorHelpBrowserFixture(count: number): TutorState {
  if (!Number.isInteger(count) || count < 0 || count > 4) throw new RangeError("도움 시험 단계는 0~4 정수여야 합니다.");
  let state: TutorState = beginDirectTutorAnswer(tutorStateFixture());
  for (let index: number = 0; index < count; index++) {
    const answer = { ...tutorAnswerFixture(), id: tutorId(70 + index), attemptId: state.question.attemptId, helped: index > 0 };
    state = finishTutorDiagnosis(beginTutorDiagnosis(saveTutorAnswer(state, answer)), { ...tutorDiagnosisFixture(), answerId: answer.id, correct: false, needsHelp: true });
    const scaffold: TutorScaffold = { kind: "tutor-scaffold", questionId: state.question.id, answerId: answer.id, stage: tutorHelpStage.options[index], explanation: { ...tutorLessonFixture().explanation, text: index === 0 ? TUTOR_DIRECTION_TEXT : `현재 도움 설명 ${index + 1}` }, learnerPrompt: index === 0 ? TUTOR_DIRECTION_PROMPT : "한 부분을 직접 설명해 주세요." };
    state = finishTutorHelp(beginTutorHelp(state), scaffold, tutorId(50 + index), tutorId(60 + index), 10 + index);
  }
  return { ...state, help: state.help.map((entry) => ({ ...entry, deliveredAt: entry.committedAt + 1 })) };
}
