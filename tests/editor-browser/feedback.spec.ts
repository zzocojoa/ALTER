import { expect, test } from "@playwright/test";
import { initialEditor, recordEditorDraft } from "../../lib/editor/state";
import { beginEditorFeedback, finishEditorFeedback } from "../../lib/editor/feedback";
import { publicEditorView } from "../../lib/editor/view";
import { saveTutorAnswer } from "../../lib/tutor/state";
import type { TutorState } from "../../lib/tutor/contracts";
import { editorReadyFixture } from "../fixtures/editor-state";
import { editorFeedbackFixture } from "../fixtures/editor-output";
import { tutorId, tutorStartFixture } from "../fixtures/tutor-state";
import { mountEditorView } from "../fixtures/editor-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";

function photoFeedbackFixture(): TutorState {
  const first: TutorState = initialEditor(tutorId(11), tutorStartFixture(), tutorId(12), tutorId(13));
  const draft = { text: "3/8입니다. 여덟 조각 중 세 조각입니다.", fileIds: [tutorId(101), tutorId(102)] };
  const state: TutorState = beginEditorFeedback(recordEditorDraft(saveTutorAnswer({ ...first, draft }, { id: tutorId(14), questionId: first.question.id, attemptId: first.question.attemptId, text: draft.text, fileIds: draft.fileIds, submittedAt: 1, helped: false })));
  const output = editorFeedbackFixture(state);
  return finishEditorFeedback(state, { id: tutorId(20), helpEventId: tutorId(21), helpAttemptId: tutorId(23), itemIds: [tutorId(22), tutorId(24)], output: { ...output, basis: [...output.basis, { location: { kind: "image", fileId: tutorId(102), left: .2, top: .3, right: .7, bottom: .6 }, criterion: "self-explanation", criterionQuote: state.start.bundle.unit.selfExplanationCriterion }], items: [...output.items, { basisIndex: 1, issue: "readability", direction: "clarify-writing", citations: output.items[0].citations }] }, committedAt: 2 });
}

test("두 핵심 피드백이 저장된 글과 두 번째 사진 구간·기준·출처에 연결됨", async ({ page }, info): Promise<void> => {
  const state: TutorState = photoFeedbackFixture();
  const view = publicEditorView(state);
  await mountEditorView(page, { ...view, feedbacks: view.feedbacks.map((item) => ({ ...item, needsRecheck: true })) });
  const feedback = page.getByRole("region", { name: "초안에 연결된 피드백", exact: true });
  await expect(feedback.getByRole("region", { name: /^핵심/ })).toHaveCount(2);
  await expect(feedback.getByRole("alert")).toContainText("원문·기준이 정정");
  await feedback.getByText("제출한 글에서 위치 보기", { exact: true }).click();
  await expect(feedback.locator("mark")).toHaveText("3/8입니다. 여덟 조각 중 세 조각입니다.");
  await expect(feedback.getByRole("img")).toHaveAccessibleName(/사진 2의 피드백 위치/);
  await expect(feedback.locator(".editor-photo-region")).toHaveAttribute("x", "20");
  await expect(feedback.locator(".editor-photo-region")).toHaveAttribute("y", "30");
  await expect(feedback.getByRole("link", { name: "제출한 사진 2 원본 열기 (새 탭)", exact: true })).toHaveAttribute("href", `/api/materials/${tutorId(102)}/file`);
  await expect(feedback.getByRole("link", { name: "교재 근거 1 열기 (새 탭)", exact: true })).toHaveCount(2);
  const links = await feedback.getByRole("link").evaluateAll((elements): string[] => elements.map((element): string => element.getAttribute("target") ?? ""));
  expect(links).toEqual(["_blank", "_blank", "_blank"]);
  await expect(feedback.getByText(state.start.bundle.unit.selfExplanationCriterion, { exact: true })).toHaveCount(2);
  expect(await page.locator("body").innerText()).not.toContain(state.start.bundle.sources[0].evidence);
  await checkAccessibility(page, ".editor-feedback", info);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.pageErrors()).toEqual([]);
  await page.screenshot({ path: `outputs/ui-editor/feedback-o2-${info.project.name}.png`, fullPage: true });
});

test("최신 피드백을 먼저 표시하고 이전 판의 정확한 문장은 펼쳐서 확인", async ({ page }): Promise<void> => {
  await mountEditorView(page, publicEditorView(editorReadyFixture()));
  const feedback = page.getByRole("region", { name: "초안에 연결된 피드백", exact: true });
  await expect(feedback.getByRole("article", { name: "초안 2판 피드백", exact: true })).toBeVisible();
  await expect(feedback.getByRole("article", { name: "초안 1판 피드백", exact: true })).toBeHidden();
  await feedback.getByText("이전 피드백 이력 (1)", { exact: true }).click();
  await expect(feedback.getByRole("article", { name: "초안 1판 피드백", exact: true })).toBeVisible();
  await expect(feedback.locator("blockquote")).toHaveText("1/4은 네 조각");
  await feedback.getByText("이전 피드백 이력 (1)", { exact: true }).click();
  await expect(feedback.getByRole("article", { name: "초안 1판 피드백", exact: true })).toBeHidden();
});
