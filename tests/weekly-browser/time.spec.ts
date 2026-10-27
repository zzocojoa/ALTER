import { expect, test } from "@playwright/test";
import { weeklyViewFixture, mountWeeklyView } from "../fixtures/weekly-ui-browser";
import { tutorId } from "../fixtures/tutor-state";
import { checkAccessibility } from "../fixtures/accessibility";

for (const available of [0, 10, 20, 60]) test(`가용 ${available}분의 전체 활동 배정과 단원 합계를 보존`, async ({ page }, info): Promise<void> => {
  const data = await weeklyViewFixture();
  await mountWeeklyView(page, { ...data, state: { ...data.state, context: { ...data.state.context, availableMinutes: available } } });
  const time = page.getByRole("region", { name: "다음 주 시간 배정", exact: true });
  const assigned = available >= 20 ? 20 : 0;
  await expect(time.locator(".weekly-time-totals dd")).toHaveText([`${available}분`, "20분", `${assigned}분`, `${available-assigned}분`]);
  await expect(time.locator(".weekly-time-units")).toContainText(`예상 20분 · 배정 ${assigned}분 · 미배정 활동 ${assigned === 0 ? 1 : 0}개`);
  await expect(time).toContainText(data.state.context.units[0].title);
  await page.locator('input[name="availableMinutes"]').fill("45");
  await expect(time).toContainText("마지막으로 저장한 초안 기준");
  await expect(time.locator(".weekly-time-totals dd").first()).toHaveText(`${available}분`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, ".weekly-workspace", info);
});

 test("두 단원의 시간 합계와 부족한 활동 전체 미배정을 구분", async ({ page }): Promise<void> => {
  const data = await weeklyViewFixture(); const state = data.state; if (!state.proposal) throw new Error("시험 제안 누락");
  const unit = { ...state.context.units[0], unitId: tutorId(1950), title: "새 단원 · 다음 조건 확인" };
  await mountWeeklyView(page, { ...data, state: { ...state, context: { ...state.context, availableMinutes: 30, units: [...state.context.units, unit] }, proposal: { ...state.proposal, items: [...state.proposal.items, { unitId: unit.unitId, targetUnitId: unit.unitId, action: "gather-evidence", estimatedMinutes: 15, activity: "다음 단원을 새 예시로 확인", claimIds: [] }] } } });
  const time = page.getByRole("region", { name: "다음 주 시간 배정", exact: true });
  await expect(time.locator(".weekly-time-totals dd")).toHaveText(["30분", "35분", "20분", "10분"]);
  await expect(time.locator(".weekly-time-units li")).toHaveCount(2);
  await expect(time.locator(".weekly-time-units li").filter({ hasText: unit.title })).toContainText("예상 15분 · 배정 0분 · 미배정 활동 1개");
});
