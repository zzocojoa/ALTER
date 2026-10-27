import { expect, it } from "vitest";
import { publicTutorView } from "../../lib/tutor/view";
import { pauseTutor, saveTutorAnswer } from "../../lib/tutor/state";
import { tutorHelpBrowserFixture } from "../fixtures/tutor-help-browser";
import { tutorAnswerFixture, tutorId } from "../fixtures/tutor-state";

it("도움 본문을 제외한 누적 단계는 새 답안·일시정지 뒤에도 유지한다", (): void => {
  const state = tutorHelpBrowserFixture(4);
  const before: string = JSON.stringify(state);
  const answered = saveTutorAnswer(state, { ...tutorAnswerFixture(), id: tutorId(90), attemptId: state.question.attemptId, helped: true });
  for (const value of [answered, pauseTutor(answered)]) {
    const view = publicTutorView(value);
    expect(view.helpHistory.map((item) => item.stage)).toEqual(["direction", "small-question", "similar-example", "full-explanation"]);
    expect(view.helpHistory).toHaveLength(4); expect(view.help).toBeNull();
    for (const item of view.helpHistory) expect(Object.keys(item).sort()).toEqual(["answerId", "committedAt", "id", "questionId", "stage"]);
    expect(JSON.stringify(view)).not.toContain("현재 도움 설명");
  }
  expect(JSON.stringify(state)).toBe(before);
});

it("저장된 도움의 순서와 식별자를 유지하고 빈 이력을 임의 생성하지 않는다", (): void => {
  expect(publicTutorView(tutorHelpBrowserFixture(0)).helpHistory).toEqual([]);
  const state = tutorHelpBrowserFixture(3);
  expect(publicTutorView(state).helpHistory.map((entry) => entry.id)).toEqual(state.help.map((entry) => entry.id));
});
