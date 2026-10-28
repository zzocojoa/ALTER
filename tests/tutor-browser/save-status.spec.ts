import { expect, test } from "@playwright/test";
import { beginTutorRecall, beginTutorLesson, finishTutorLesson, saveTutorAnswer, beginTutorDiagnosis } from "../../lib/tutor/state";
import { tutorStateFixture, tutorLessonFixture, tutorAnswerFixture } from "../fixtures/tutor-state";
import { mountTutorInput } from "../fixtures/tutor-input-browser";

/** 응답을 지연해 화면 입력·초안 확인·명시적 제출을 각각 관찰합니다. */
test("초안과 제출은 서버 응답 전후의 서로 다른 저장 상태로 표시된다", async ({ page }, info) => {
  const state = beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture()));
  const fixture = await mountTutorInput(page, state);
  const draft = Promise.withResolvers<void>(); const submitted = Promise.withResolvers<void>();
  await page.route("https://tutor.local.test/api/tutor", async (route): Promise<void> => {
    if (route.request().method() === "POST") {
      const input: { action: string } = route.request().postDataJSON();
      if (input.action === "draft") await draft.promise;
      if (input.action === "submit") await submitted.promise;
    }
    await route.fallback();
  });
  await page.getByRole("textbox", { name: "나의 답안", exact: true }).fill("서버 응답을 확인할 답안입니다.");
  await expect(page.getByText("아직 저장하지 않은 입력이 있어요", { exact: true })).toBeVisible();
  await expect(page.getByText("서버에 초안을 저장하고 있어요", { exact: true })).toBeVisible();
  await expect(page.locator("#tutor-draft-status")).toHaveAttribute("data-persistence", "unconfirmed"); expect(fixture.actions).toEqual([]);
  draft.resolve(); await expect(page.getByText("서버 초안 저장을 확인했어요", { exact: true })).toBeVisible();
  await expect(page.locator("#tutor-draft-status")).toHaveAttribute("data-persistence", "draft"); expect(fixture.read().answers).toHaveLength(0);
  await page.getByRole("button", { name: "답안 제출·저장", exact: true }).click();
  await expect(page.getByText("답안을 제출하고 있어요", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "답안 제출·저장", exact: true })).toBeDisabled(); expect(fixture.read().answers).toHaveLength(0);
  submitted.resolve(); await expect(page.getByText("답안 제출을 확인했어요", { exact: true })).toBeVisible();
  await expect(page.locator("#tutor-draft-status")).toHaveAttribute("data-persistence", "answer"); expect(fixture.read().answers).toHaveLength(1); expect(fixture.read().diagnosis).toBeNull();
  expect(fixture.actions).toEqual(["draft", "submit"]);
  await page.screenshot({ path: `outputs/ui-tutor/submitted-m4-${info.project.name}.png`, fullPage: true });
});

test("AI 대기 중에도 서버 제출 확인과 평가 대기를 별도로 표시한다", async ({ page }) => {
  const awaiting = beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture()));
  const state = beginTutorDiagnosis(saveTutorAnswer(awaiting, tutorAnswerFixture()));
  const fixture = await mountTutorInput(page, state);
  await expect(page.getByText("답안 제출을 확인했어요", { exact: true })).toBeVisible(); await expect(page.getByText("AI 결과 확인 대기", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "기존 요청 결과 확인", exact: true })).toBeVisible(); await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(fixture.actions).toEqual([]);
});
