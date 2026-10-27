import { expect, test } from "@playwright/test";
import { reviewPlanFixture, mountReviewView } from "../fixtures/review-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";

test("당일로 바꾼 일정과 저장 이유를 보여도 지연 재현·완료로 승격하지 않음", async ({ page }, info): Promise<void> => {
  const base = reviewPlanFixture(); const plan = { ...base, version: 2, dueState: "today" as const, decision: { ...base.decision, status: "changed" as const, dueDate: "2026-10-25", reason: "다음 날 제안을 오늘 연습으로 변경" } };
  await mountReviewView(page, { today: "2026-10-25", legacy: [], plans: [plan] }, `#review-${plan.id}`);
  const meaning = page.getByRole("region", { name: "일정 선택과 실제 수행 구분", exact: true });
  await expect(meaning).toContainText("조건 또는 날짜를 바꿔 수락");
  await expect(meaning).toContainText("다음 날 제안을 오늘 연습으로 변경");
  await expect(meaning).toContainText("2026-10-26");
  await expect(meaning).toContainText("오늘 날짜로 수락한 일정");
  await expect(meaning).toContainText("날짜만 앞당겨서는 지연 재현으로 바뀌지 않아요");
  await expect(page.getByRole("region", { name: "완료 복습", exact: true }).locator(".review-count")).toHaveText("0개");
  await page.reload(); await expect(meaning).toContainText("다음 날 제안을 오늘 연습으로 변경");
  await checkAccessibility(page, ".review-overview", info);
});
