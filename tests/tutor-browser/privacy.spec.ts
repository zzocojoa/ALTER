import { expect, test } from "@playwright/test";
import { beginTutorLesson, finishTutorLesson, beginTutorRecall, saveTutorAnswer, reviseTutorAnswer, pauseTutor, finishTutorSession } from "../../lib/tutor/state";
import { publicTutorView } from "../../lib/tutor/view";
import type { TutorState } from "../../lib/tutor/contracts";
import { tutorStateFixture, tutorLessonFixture, tutorAnswerFixture, tutorId } from "../fixtures/tutor-state";
import { mountTutorInput } from "../fixtures/tutor-input-browser";

const explained: TutorState = finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture());
const answered: TutorState = saveTutorAnswer(beginTutorRecall(explained), { ...tutorAnswerFixture(), text: "이전 시도의 정답 설명은 인출 중 보이면 안 됩니다." });
const recalling: TutorState = reviseTutorAnswer(answered, tutorId(71));
const concealed: readonly TutorState[] = [recalling, pauseTutor(recalling)];
for (const state of concealed) test(`${state.phase}: 새로고침·딥링크·복귀에도 원문·과거 설명·이전 답안을 전달하지 않는다`, async ({ page }) => {
  const fixture = await mountTutorInput(page, state);
  const secrets: readonly string[] = [explained.start.bundle.sources[0].evidence, tutorLessonFixture().explanation.text, answered.answers[0].text];
  for (const value of secrets) expect(JSON.stringify(publicTutorView(state))).not.toContain(value);
  for (const operation of ["initial", "reload", "return"] as const) {
    if (operation === "reload") { await page.goto(`https://tutor.local.test/learn/tutor?id=${state.id}#tutor-answer`); await page.reload(); }
    if (operation === "return") {
      await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); }); await expect(page.getByRole("region", { name: "현재 수업", exact: true })).toHaveCount(0);
      await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pageshow")); });
    }
    await expect(page.getByRole("region", { name: "현재 수업", exact: true })).toBeVisible();
    const markup: string = await page.locator(".tutor-workspace").innerHTML(); const accessible: string = await page.locator(".tutor-workspace").ariaSnapshot();
    for (const value of secrets) { expect(markup).not.toContain(value); expect(accessible).not.toContain(value); }
    await expect(page.getByTestId("tutor-question")).toHaveCount(state.phase === "paused" ? 0 : 1);
    await expect(page.locator("blockquote")).toHaveCount(0); await expect(page.getByRole("button", { name: "저장한 답안 진단", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "오늘의 한 걸음", exact: true })).toHaveCount(0); expect(fixture.actions).toEqual([]);
  }
});

test("인출 전에는 확인한 설명을 읽고 종료 후에는 저장 답안과 결과 링크를 확인한다", async ({ page }) => {
  await mountTutorInput(page, explained);
  await expect(page.getByText(tutorLessonFixture().explanation.text, { exact: true })).toBeVisible(); await expect(page.locator("blockquote")).toHaveCount(1);
  await page.unrouteAll({ behavior: "wait" });
  const finished = finishTutorSession(answered); const fixture = await mountTutorInput(page, finished);
  await expect(page.getByText(answered.answers[0].text, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "이 수업 결과 확인·확정", exact: true })).toHaveAttribute("href", `/learn/results?id=${finished.id}`);
  await expect(page.getByRole("textbox")).toHaveCount(0); expect(fixture.actions).toEqual([]);
});
