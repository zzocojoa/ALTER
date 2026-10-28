import type { UsageDashboard } from "../../lib/dashboard/usage";
import { expect, test } from "@playwright/test";
import { fixtureUsageDashboard } from "../fixtures/dashboard-usage";
import { mountUsage } from "../fixtures/usage-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";

test("원화 0원·미확정 1만원 예약·30센트 시도 상한·과거 잔액을 별도 지표로 표시", async ({ page }, info): Promise<void> => {
  const data = fixtureUsageDashboard(Date.now()); if (!data.ai.funding) throw new Error("자금 시험값 누락");
  const value = { ...data, ai: { ...data.ai, funding: { ...data.ai.funding, probeLimitUsdMicros: 300000 } } };
  let reads: number = 0; await mountUsage(page, async route => { reads += 1; await route.fulfill({ json: value }); }, "#check-budget");
  const panel = page.locator("#check-budget"); await expect(panel).toBeFocused();
  await expect(panel.locator('[data-funding-metric="reconciled"] .funding-value')).toHaveText("0원");
  await expect(panel.locator('[data-funding-metric="pending"] .funding-value')).toHaveText("10,000원");
  await expect(panel.locator('[data-funding-metric="committed"] .funding-value')).toHaveText("10,000원");
  await expect(panel.locator('[data-funding-metric="limit"] .funding-value')).toHaveText("US$0.300000");
  await expect(panel.locator('[data-funding-metric="attempts"] .funding-value')).toHaveText("US$0.041730");
  await expect(panel.locator('[data-funding-metric="credit"]')).toContainText("현재 잔액은 미확인");
  await expect(panel).toContainText("자동 충전 꺼짐"); await expect(panel).toContainText("추가 충전은 허용하지 않아요");
  expect(reads).toBe(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await checkAccessibility(page, "#check-budget", info);
  await panel.screenshot({ path: info.outputPath("비용-구분.png") });
});

test("결제 근거 누락·과거 크레딧 누락은 0원으로 바꾸지 않음", async ({ page }): Promise<void> => {
  const data = fixtureUsageDashboard(Date.now()); if (!data.ai.funding) throw new Error("자금 시험값 누락");
  let value: UsageDashboard = { ...data, ai: { ...data.ai, funding: null, windows: [] } };
  await mountUsage(page, async route => { await route.fulfill({ json: value }); }, "");
  await expect(page.locator("#check-budget")).toContainText("임의의 잔액을 부여하지 않아요"); await expect(page.locator(".funding-metrics")).toHaveCount(0);
  value = { ...value, ai: { ...value.ai, funding: { ...data.ai.funding, probeLimitUsdMicros: null, probeCreditSnapshotUsdMicros: null } } };
  await page.getByRole("button", { name: "사용량 원장 새로 읽기" }).click();
  await expect(page.locator('[data-funding-metric="credit"] .funding-value')).toHaveText("미확인"); await expect(page.locator('[data-funding-metric="limit"] .funding-value')).toHaveText("설정 근거 없음");
  await expect(page.getByText("이번 달 원장이 아직 없어요. 사용 가능 잔액을 0원으로 판정하지 않아요.", { exact: true })).toBeVisible();
});

test("확인 기간이 지나면 과거 잔액은 유지하되 현재 관측으로 표시하지 않음", async ({ page }): Promise<void> => {
  const now: number = Date.now(); await page.clock.install({ time: now });
  const data = fixtureUsageDashboard(now); if (!data.ai.funding) throw new Error("자금 시험값 누락");
  await mountUsage(page, async route => { await route.fulfill({ json: { ...data, ai: { ...data.ai, funding: { ...data.ai.funding, validUntil: now + 5000 } } } }); }, "");
  await expect(page.getByText("저장된 관측의 확인 기간 내", { exact: true })).toBeVisible();
  await page.clock.fastForward(20_000); await expect(page.getByText("관측 확인 기간 만료", { exact: true })).toBeVisible();
  await expect(page.locator('[data-funding-metric="credit"] .funding-value')).toHaveText("US$5.000000");
  await expect(page.locator('[data-funding-metric="credit"]')).toContainText("현재 잔액은 미확인");
});

test("복원된 원장의 금액은 새 외부 실행 권한으로 표시하지 않음", async ({ page }): Promise<void> => {
  const data = fixtureUsageDashboard(Date.now());
  await mountUsage(page, async route => { await route.fulfill({ json: { ...data, restoration: { runId: null, activatedAt: null, learning: "active", externalAuthority: "unverified" } } }); }, "");
  await expect(page.locator("#check-budget")).toContainText("복원한 과거 관측 · 현재 사용 권한 미확인");
  await expect(page.getByText(/현재 원장 대사 전에는 AI·Google 호출과 기존 작업 재실행을 차단/)).toBeVisible();
});

test("관측 시각이 없는 응답은 금액 표시 대신 조회 오류로 처리", async ({ page }): Promise<void> => {
  const data = fixtureUsageDashboard(Date.now()); if (!data.ai.funding) throw new Error("자금 시험값 누락");
  const funding = { ...data.ai.funding, checkedAt: undefined };
  await mountUsage(page, async route => { await route.fulfill({ json: { ...data, ai: { ...data.ai, funding } } }); }, "");
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.locator(".funding-metrics")).toHaveCount(0);
});
