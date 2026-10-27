import { expect, test } from "@playwright/test";
import { reviewPlanFixture, mountReviewView } from "../fixtures/review-ui-browser";
import { tutorId } from "../fixtures/tutor-state";
import { checkAccessibility } from "../fixtures/accessibility";
import type { SavedReviewPlan } from "../../lib/reviews/view";

test.use({ timezoneId: "America/Los_Angeles" });
const cases: readonly Readonly<{ name: string; today: string; state: SavedReviewPlan["dueState"]; status: SavedReviewPlan["decision"]["status"]; enabled: boolean; reason: string }>[] = [
  { name: "미수락", today: "2026-10-25", state: "proposed", status: "proposed", enabled: false, reason: "아직 복습 날짜를 수락하지 않았어요" },
  { name: "예정일 전", today: "2026-10-24", state: "future", status: "accepted", enabled: false, reason: "2026-10-25부터 시작할 수 있어요" },
  { name: "예정일 당일", today: "2026-10-25", state: "today", status: "accepted", enabled: true, reason: "복습할 시간이 되었어요" },
  { name: "예정일 이후", today: "2026-10-26", state: "overdue", status: "changed", enabled: true, reason: "복습할 시간이 되었어요" },
  { name: "완료", today: "2026-10-26", state: "complete", status: "accepted", enabled: false, reason: "제출 결과가 확정되었어요" },
  { name: "날짜 미확인", today: "날짜 미확인", state: "today", status: "accepted", enabled: false, reason: "서버의 서울 날짜를 확인하지 못했어요" },
];
for (const scenario of cases) test(`서버 날짜로 실행 상태 표시 · ${scenario.name}`, async ({ page }, info): Promise<void> => {
  const base = reviewPlanFixture(); const plan = { ...base, dueState: scenario.state, decision: { ...base.decision, status: scenario.status, dueDate: "2026-10-25" } };
  await page.clock.install({ time: new Date("2099-12-31T00:00:00Z") });
  await mountReviewView(page, { today: scenario.today, plans: [plan], legacy: [] }, `#review-${plan.id}`);
  const section = page.getByRole("region", { name: "복습 시작과 답안 위치", exact: true });
  await expect(section.getByRole("status")).toContainText(scenario.reason);
  await expect(section.locator(".review-start-dates")).toContainText(scenario.today);
  const button = section.getByRole("button", { name: "자료 가리고 복습 시작", exact: true });
  if (scenario.enabled) await expect(button).toBeEnabled();
  else { await expect(button).toBeDisabled(); await expect(section.getByText("위 버튼으로 복습을 시작하거나 이어가세요.", { exact: true })).toHaveCount(0); }
  await checkAccessibility(page, ".review-overview", info);
});

for (const phase of ["paused", "finished", null, "unknown"] as const) test(`기존 회차는 새 시작을 만들지 않음 · ${phase}`, async ({ page }): Promise<void> => {
  const base = reviewPlanFixture(); const plan = { ...base, dueState: "today" as const, sessionId: tutorId(190), sessionPhase: phase, decision: { ...base.decision, status: "accepted" as const, dueDate: "2026-10-25" } };
  await mountReviewView(page, { today: "2026-10-25", plans: [plan], legacy: [] }, `#review-${plan.id}`);
  const section = page.getByRole("region", { name: "복습 시작과 답안 위치", exact: true });
  if (phase === "paused") await expect(section.getByRole("link", { name: "이 복습 회차 이어가기", exact: true })).toHaveAttribute("href", `/learn/tutor?id=${plan.sessionId}#tutor-answer-area`);
  else if (phase === "finished") await expect(section.getByRole("link", { name: "종료한 복습 결과 확인", exact: true })).toHaveAttribute("href", `/learn/results?id=${plan.sessionId}`);
  else { await expect(section.getByRole("status")).toContainText("상태를 확인하지 못했어요"); await expect(section.getByRole("button", { name: "자료 가리고 복습 시작", exact: true })).toBeDisabled(); }
});
