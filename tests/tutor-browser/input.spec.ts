import { expect, test } from "@playwright/test";
import { beginTutorRecall, beginTutorLesson, finishTutorLesson } from "../../lib/tutor/state";
import { tutorStateFixture, tutorLessonFixture, tutorId } from "../fixtures/tutor-state";
import { mountTutorInput } from "../fixtures/tutor-input-browser";
import { reviewBinding, makeReviewTask } from "../../lib/reviews/contracts";
import { reviewFields, parseReviewSubmission } from "../../lib/reviews/submission";
import type { LearningType } from "../../lib/reviews/contracts";
import { checkAccessibility } from "../fixtures/accessibility";

/** 조합 이벤트 검사는 기기 IME 수용 검사와 구분합니다. */
test("한글 조합 중 저장·제출하지 않고 완료 문자열과 제한 초과 입력을 보존한다", async ({ page }) => {
  const state = beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture()));
  const fixture = await mountTutorInput(page, state);
  const answer = page.getByRole("textbox", { name: "나의 답안", exact: true });
  await answer.dispatchEvent("compositionstart", { data: "" }); await answer.fill("한글 조합 중");
  await answer.press("Enter"); await page.waitForTimeout(1000);
  expect(fixture.actions).toEqual([]); await expect(answer).toBeEnabled(); await expect(page.getByRole("button", { name: "답안 제출·저장", exact: true })).toBeDisabled();
  await answer.fill("한글 조합 완료입니다."); await answer.dispatchEvent("compositionend", { data: "다" });
  await expect.poll(() => fixture.read().draft.text).toBe("한글 조합 완료입니다."); await expect(answer).toHaveValue("한글 조합 완료입니다.");
  const boundary: string = "가".repeat(60000); await answer.fill(boundary);
  await expect.poll(() => fixture.read().draft.text.length).toBe(60000);
  const count: number = fixture.actions.length; await answer.fill(`${boundary}나`); await page.waitForTimeout(1000);
  await expect(answer).toHaveValue(`${boundary}나`); await expect(answer).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "답안 제출·저장", exact: true })).toBeDisabled(); expect(fixture.actions).toHaveLength(count);
  await answer.fill("  "); await expect.poll(() => fixture.read().draft.text).toBe("  "); await expect(page.getByRole("button", { name: "답안 제출·저장", exact: true })).toBeDisabled();
  expect(fixture.actions.every((action): boolean => action === "draft")).toBe(true);
});

const types: readonly LearningType[] = ["memory", "concept", "skill", "judgment"];
for (const type of types) test(`복습 ${type} 필수 필드·조합·6,000자 제한과 제출 전 진단 금지`, async ({ page }, info) => {
  const original = beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture()));
  const task = makeReviewTask(type, "자료 없이 설명", tutorId(61), "원래 질문", [tutorId(7)]);
  const state = { ...original, review: reviewBinding.parse({ reviewId: tutorId(62), reviewVersion: 1, planVersion: 1, scheduleId: tutorId(63), proposalId: tutorId(64), basisResultVersionId: tutorId(65), baselineAt: 1, dueDate: "2026-10-27", kind: "variable", task, correctionId: null }) };
  const fixture = await mountTutorInput(page, state);
  const submit = page.getByRole("button", { name: "답안 제출·저장", exact: true }); await expect(submit).toBeDisabled();
  const fields = reviewFields[type]; const first = page.getByRole("textbox", { name: fields[0].label, exact: true });
  await first.dispatchEvent("compositionstart"); await first.fill("한글"); await first.press("Enter"); await page.waitForTimeout(1000); expect(fixture.actions).toEqual([]);
  await first.dispatchEvent("compositionend"); await expect.poll(() => fixture.actions.length).toBe(1);
  await first.fill("가".repeat(6001)); const count: number = fixture.actions.length; await page.waitForTimeout(1000); expect(fixture.actions).toHaveLength(count); await expect(first).toHaveAttribute("aria-invalid", "true"); await expect(submit).toBeDisabled();
  await first.fill("가".repeat(6000)); await expect.poll(() => fixture.read().draft.text).toContain("가".repeat(6000));
  for (const field of fields) await page.getByRole("textbox", { name: field.label, exact: true }).fill(`${field.label}을 내 말로 작성했습니다.`);
  await expect(submit).toBeEnabled(); await expect(page.getByText("서버 초안 저장을 확인했어요", { exact: true })).toBeVisible();
  expect(parseReviewSubmission(task, fixture.read().draft.text).type).toBe(type);
  await checkAccessibility(page, ".tutor-panel", info); await submit.click();
  await expect(page.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeVisible();
  expect(fixture.read().answers).toHaveLength(1); expect(fixture.read().diagnosis).toBeNull(); expect(fixture.actions.filter((action): boolean => action === "submit")).toHaveLength(1);
  expect(fixture.actions.every((action): boolean => ["draft", "submit"].includes(action))).toBe(true);
});
