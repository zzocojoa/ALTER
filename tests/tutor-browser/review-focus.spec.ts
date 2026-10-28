import { expect, test } from "@playwright/test";
import { beginTutorRecall, beginTutorLesson, finishTutorLesson, pauseTutor } from "../../lib/tutor/state";
import { tutorStateFixture, tutorLessonFixture, tutorId } from "../fixtures/tutor-state";
import { mountTutorInput } from "../fixtures/tutor-input-browser";
import { reviewBinding, makeReviewTask } from "../../lib/reviews/contracts";

for (const paused of [false, true]) test(`복습 실제 필드 렌더링 이후 초점 · 일시 정지 ${paused}`, async ({ page }): Promise<void> => {
  const original = beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture()));
  const task = makeReviewTask("concept", "자료 없이 설명", tutorId(61), "원래 질문", [tutorId(7)]);
  const ready = { ...original, review: reviewBinding.parse({ reviewId: tutorId(62), reviewVersion: 1, planVersion: 1, scheduleId: tutorId(63), proposalId: tutorId(64), basisResultVersionId: tutorId(65), baselineAt: 1, dueDate: "2026-10-27", kind: "variable", task, correctionId: null }) };
  const fixture = await mountTutorInput(page, paused ? pauseTutor(ready) : ready);
  await page.evaluate((): void => { window.location.hash = "tutor-answer-area"; });
  const example = page.getByRole("textbox", { name: "새 예시", exact: true });
  if (paused) { await expect(example).toHaveCount(0); expect(fixture.actions).toEqual([]); return; }
  await expect(example).toBeFocused();
  const explanation = page.getByRole("textbox", { name: "자신의 설명", exact: true });
  await example.fill("여덟 조각 중 셋은 3/8입니다."); await explanation.fill("전체를 같은 크기로 나눈 부분입니다.");
  await expect(page.getByText("서버 초안 저장을 확인했어요", { exact: true })).toBeVisible();
  await expect(explanation).toBeFocused();
  await page.reload(); await expect(example).toHaveValue("여덟 조각 중 셋은 3/8입니다."); await expect(example).toBeFocused();
  await page.getByRole("button", { name: "답안 제출·저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeVisible();
  expect(fixture.read().answers).toHaveLength(1); expect(fixture.read().diagnosis).toBeNull();
});
