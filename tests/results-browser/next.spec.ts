import { expect, test } from "@playwright/test";
import { resultDraftFixture, mountResultView } from "../fixtures/result-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";
import { tutorId } from "../fixtures/tutor-state";

test("미확정 후보에는 확정 뒤 이동을 노출하지 않음", async ({ page }): Promise<void> => {
  await mountResultView(page, resultDraftFixture());
  await expect(page.getByRole("region", { name: "확정 후 다음 행동", exact: true })).toHaveCount(0);
});

test("확정 후 복습·학습 범위 이동은 수락이나 시작 요청을 발생시키지 않음", async ({ page }, info): Promise<void> => {
  const base = resultDraftFixture();
  await mountResultView(page, { ...base, confirmation: { id: tutorId(70), resultId: tutorId(71), version: 2, confirmedAt: 1, judgment: base.judgment }, canConfirm: false, reviews: [{ id: tutorId(80), version: 1, correctionId: tutorId(81), nextAction: "원문을 다시 확인하고 복습하세요.", recheckState: "required" }] });
  const next = page.getByRole("region", { name: "확정 후 다음 행동", exact: true });
  await expect(next).toContainText("재검증이 남아 있어요");
  await expect(next.getByRole("link", { name: "복습 제안·날짜 확인", exact: false })).toHaveAttribute("href", "/learn/tutor#reviews");
  await expect(next.getByRole("link", { name: "다음 학습 범위 고르기", exact: false })).toHaveAttribute("href", "/learn/library#scope-setup");
  await checkAccessibility(page, ".result-card", info);
  await page.screenshot({ path: `outputs/ui-results/next-p5-${info.project.name}.png`, fullPage: true });
  const writes: string[] = [];
  page.on("request", (request): void => { if (request.method() !== "GET") writes.push(request.url()); });
  await page.route("**/learn/tutor", async (route): Promise<void> => { await route.fulfill({ contentType: "text/html", body: '<h1 id="reviews">복습 도착</h1>' }); });
  await next.getByRole("link", { name: "복습 제안·날짜 확인", exact: false }).click();
  await expect(page).toHaveURL(/\/learn\/tutor#reviews$/);
  await page.goBack();
  await expect(next).toBeVisible();
  await page.route("**/learn/library", async (route): Promise<void> => { await route.fulfill({ contentType: "text/html", body: '<h1 id="scope-setup">범위 도착</h1>' }); });
  await next.getByRole("link", { name: "다음 학습 범위 고르기", exact: false }).click();
  await expect(page).toHaveURL(/\/learn\/library#scope-setup$/);
  expect(writes).toEqual([]);
});
