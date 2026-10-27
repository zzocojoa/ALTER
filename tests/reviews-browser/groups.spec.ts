import { expect, test } from "@playwright/test";
import { reviewPlanFixture, mountReviewView } from "../fixtures/review-ui-browser";
import { tutorId } from "../fixtures/tutor-state";
import { checkAccessibility } from "../fixtures/accessibility";
import type { SavedReviewPlan } from "../../lib/reviews/view";

const states: readonly SavedReviewPlan["dueState"][] = ["today", "overdue", "recheck", "proposed", "future", "complete"];
const labels: readonly string[] = ["오늘", "기한 지남", "재확인", "미수락", "예정", "완료"];

test("서버 여섯 분류를 중복 없이 표시하고 개별 복습 링크가 해당 항목을 펼침", async ({ page }, info): Promise<void> => {
  const base = reviewPlanFixture();
  const plans = states.map((state, index): SavedReviewPlan => ({ ...base, id: tutorId(110 + index), title: `${labels[index]} 시험`, dueState: state, sessionId: index === 1 ? tutorId(190) : null, sessionPhase: index === 1 ? "paused" : null }));
  await mountReviewView(page, { today: "2026-10-25", legacy: [], plans }, `#review-${plans[0].id}`);
  for (const [index, label] of labels.entries()) {
    const group = page.getByRole("region", { name: `${label} 복습`, exact: true });
    await expect(group.locator("details.review-card")).toHaveCount(1);
    await expect(group.locator(".review-count")).toHaveText("1개");
    await expect(group.locator("summary").first()).toContainText(plans[index].title);
  }
  await expect(page.locator("details.review-card")).toHaveCount(6);
  await expect(page.locator(`#review-${plans[0].id}`)).toHaveAttribute("open", "");
  await expect(page.locator(`#review-${plans[0].id} > summary`)).toBeFocused();
  await expect(page.getByRole("region", { name: "기한 지남 복습", exact: true })).toContainText("진행 중인 복습 회차 있음");
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, ".review-overview", info);
  await page.screenshot({ path: `outputs/ui-reviews/groups-q2-${info.project.name}.png`, fullPage: true });
});

test("빈 그룹과 조회 실패를 구분하고 실패 후 기존 내용을 다시 노출하지 않음", async ({ page }): Promise<void> => {
  await mountReviewView(page, { today: "2026-10-25", legacy: [], plans: [] }, "#reviews");
  await expect(page.getByText("해당 복습이 없어요.", { exact: true })).toHaveCount(6);
  await page.route("**/api/reviews", async (route): Promise<void> => { await route.fulfill({ status: 503, json: { error: "storage_failure", message: "저장소 상태 확인 실패" } }); });
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  await expect(page.getByRole("status")).toContainText("HTTP 503");
  await expect(page.getByText("해당 복습이 없어요.", { exact: true }).first()).toBeHidden();
});
