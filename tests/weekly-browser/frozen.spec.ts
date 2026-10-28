import { expect, test } from "@playwright/test";
import { weeklyFrozenFixture, mountWeeklyFrozen } from "../fixtures/weekly-frozen-browser";
import { tutorId } from "../fixtures/tutor-state";
import { checkAccessibility } from "../fixtures/accessibility";

for (const item of [{ state: "pending", label: "내보내기 대기 · 외부 저장 미확인" }, { state: "running", label: "내보내기 처리 중 · 외부 저장 미확인" }, { state: "partial", label: "일부만 연동 · 전체 완료 아님" }, { state: "complete", label: "외부 연동 완료" }, { state: "conflict", label: "외부 내용 충돌 · 확인 필요" }]) test(`확정본 직접 URL · ${item.state} · 읽기 전용과 원래 기록 복귀`, async ({ page }, info): Promise<void> => {
  const original = await weeklyFrozenFixture(); const data = { ...original, exportState: item.state }; let reads: number = 0;
  await mountWeeklyFrozen(page, data, async (route): Promise<void> => { reads += 1; await route.fulfill({ json: data }); });
  await expect(page.getByText("읽기 전용 · 확정 기록 3판", { exact: true })).toBeVisible();
  await expect(page.getByText(item.label, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "현재 주간 점검으로", exact: true })).toHaveAttribute("href", `/learn/weekly?id=${data.state.id}`);
  await expect(page.locator("input,textarea,select,form")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "다음 주 시간 배정", exact: true }).locator(".weekly-time-totals dd")).toHaveText(["30분", "20분", "20분", "10분"]);
  for (const name of ["공통점", "차이점", "비유가 성립하지 않는 조건"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(reads).toBe(0);
  await page.getByRole("button", { name: "확정본 접근·연동 상태 다시 확인", exact: true }).click();
  await expect(page.getByText(item.label, { exact: true })).toBeVisible(); expect(reads).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, ".weekly-workspace", info);
});

for (const change of ["wrong-id", "changed-content", "changed-time", "unknown-export"] as const) test(`확정본 ${change} 응답은 불변 원본을 대체하지 못함`, async ({ page }): Promise<void> => {
  const data = await weeklyFrozenFixture();
  const response = change === "wrong-id" ? { ...data, state: { ...data.state, confirmedVersionId: tutorId(1998) } } : change === "changed-content" ? { ...data, state: { ...data.state, notes: "변조된 내용" } } : change === "changed-time" ? { ...data, confirmedAt: data.confirmedAt + 1 } : { ...data, exportState: "unexpected" };
  await mountWeeklyFrozen(page, data, async (route): Promise<void> => { await route.fulfill({ json: response }); });
  await page.getByRole("button", { name: "확정본 접근·연동 상태 다시 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".weekly-workspace")).toHaveCount(0);
  await expect(page.getByText("변조된 내용", { exact: true })).toHaveCount(0);
  expect(await page.pageErrors()).toEqual([]);
});

test("확정본의 가림 후 늦은 응답·403은 재노출하지 않고 같은 버전만 복구", async ({ page }): Promise<void> => {
  const data = await weeklyFrozenFixture(); let release: () => void = (): void => {}; let started: () => void = (): void => {};
  const waiting = new Promise<void>(resolve => { started = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; }); let mode: "delayed" | "denied" | "restore" = "delayed";
  await mountWeeklyFrozen(page, data, async (route): Promise<void> => { if (mode === "delayed") { started(); await gate; } await route.fulfill({ status: mode === "denied" ? 403 : 200, json: mode === "denied" ? { message: "접근 거부" } : { ...data, current: false, issue: "현재 근거가 달라 재검증이 필요한 이전 확정본이에요.", exportState: "partial" } }); });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow"))); await waiting;
  await page.evaluate(() => window.dispatchEvent(new Event("alter:recall-starting"))); release();
  await expect(page.locator(".weekly-workspace")).toHaveCount(0);
  mode = "denied"; await page.getByRole("button", { name: "다시 확인", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("HTTP 403");
  await expect(page.locator("blockquote")).toHaveCount(0);
  mode = "restore"; await page.getByRole("button", { name: "다시 확인", exact: true }).click(); await expect(page.getByText("읽기 전용 · 확정 기록 3판", { exact: true })).toBeVisible();
  await expect(page.getByText("일부만 연동 · 전체 완료 아님", { exact: true })).toBeVisible();
  await expect(page.locator(".weekly-note")).toHaveText(data.state.notes);
  await expect(page.locator("input,textarea,select,form")).toHaveCount(0); expect(await page.pageErrors()).toEqual([]);
});
