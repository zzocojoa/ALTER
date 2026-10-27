import { expect, test } from "@playwright/test";
import { fixtureUsageDashboard } from "../fixtures/dashboard-usage";
import { mountUsage } from "../fixtures/usage-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";

for (const mode of ["normal", "blocked", "full", "expired"] as const) test(`저장소 ${mode}에서 사용·예약·한도·미완료 등록을 구분하고 조회만 수행`, async ({ page }, info): Promise<void> => {
  const now: number = Date.now(); const data = fixtureUsageDashboard(now);
  const material = { limitBytes: 256 * 1048576, occupiedBytes: (mode === "full" ? 255 : 20) * 1048576, reservedBytes: 2 * 1048576, untrackedBytes: 1048576, activeTransfers: 2, blocked: mode === "blocked", checkedAt: now - 60000, validUntil: now + (mode === "expired" ? -1000 : 60000) };
  const value = { ...data, platform: { ...data.platform, material } }; const before: string = JSON.stringify(material); let reads: number = 0;
  await mountUsage(page, async route => { reads += 1; await route.fulfill({ json: value }); }, "");
  const region = page.getByRole("region", { name: "사이트와 저장 공간", exact: true });
  await expect(region.locator('[data-storage-metric="reserved"] strong')).toHaveText("2.00 MiB"); await expect(region.locator('[data-storage-metric="limit"] strong')).toHaveText("256.00 MiB");
  await expect(region.locator('[data-storage-metric="pending"] strong')).toHaveText("2개"); await expect(region).toContainText("등록 완료 수가 아니에요");
  await expect(region).toContainText("등록 목록 밖 원본 1.00 MiB"); await expect(region).toContainText("다시 더하지 않아요");
  const expected: Readonly<Record<typeof mode, string>> = { normal: "저장된 검증 기간 내", blocked: "등록 제한 · 재확인 필요", full: "사용량·예약이 앱 한도에 도달", expired: "저장소 관측 만료 · 재확인 필요" };
  await expect(region).toContainText(expected[mode]); await expect(region.getByRole("link", { name: "자료 보관함에서 중단된 자료 확인", exact: true })).toHaveAttribute("href", "/learn/materials");
  await page.getByRole("button", { name: "사용량 원장 새로 읽기" }).click(); await expect.poll(() => reads).toBe(2); expect(JSON.stringify(material)).toBe(before);
  await checkAccessibility(page, ".storage-usage", info); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("저장소 근거 누락·조회 실패는 0 사용량이나 등록 가능으로 표시하지 않음", async ({ page }): Promise<void> => {
  const data = fixtureUsageDashboard(Date.now()); let status: number = 200;
  await mountUsage(page, async route => { await route.fulfill({ status, json: status === 200 ? data : { message: "시험 저장소 읽기 실패" } }); }, "");
  const region = page.getByRole("region", { name: "사이트와 저장 공간", exact: true }); await expect(region).toContainText("원본 저장소 상태 미확인"); await expect(region.locator(".storage-metrics")).toHaveCount(0);
  await expect(region.getByRole("link", { name: "자료 보관함과 저장 공간 확인", exact: true })).toHaveAttribute("href", "/learn/materials");
  status = 503; await page.getByRole("button", { name: "사용량 원장 새로 읽기" }).click(); await expect(page.getByRole("alert")).toContainText("HTTP 503"); await expect(region).toHaveCount(0);
});
