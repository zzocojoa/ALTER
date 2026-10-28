import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { checkAccessibility } from "../fixtures/accessibility";
import { fixtureUsageDashboard } from "../fixtures/dashboard-usage";
import type { UsageDashboard } from "../../lib/dashboard/usage";
test("비용·미확정 청구·재동의·실제 요청 분리와 뒤로가기 인증", async ({ page }, info) => {
  const script = await readFile(".sites-runtime/dashboard-browser/fixture.iife.js", "utf8");
  const css = await readFile(".sites-runtime/dashboard-browser/fixture.css", "utf8");
  let status: number = 200; let data: UsageDashboard = fixtureUsageDashboard(Date.now()); let requests: number = 0;
  await page.route("https://usage.local.test/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (path === "/api/dashboard/usage") { requests += 1; expect(route.request().method()).toBe("GET"); await route.fulfill({ status, json: data }); return; }
    expect(path).toBe("/usage");
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="dashboard-fixture"></div><script src="/fixture.js"></script></html>' });
  });
  await page.goto("https://usage.local.test/usage");
  await expect(page.getByRole("region", { name: "AI 예산과 결제" })).toContainText("US$5.500000 · 원화 청구 미확정");
  await expect(page.getByText(/원장의 원화 소비는/)).toBeVisible();
  await expect(page.getByRole("region", { name: "기능별 사용 조건" })).toContainText("직접 텍스트 답안 작성·저장 · 실행 시 확인 필요");
  await expect(page.getByRole("region", { name: "기능별 사용 조건" })).toContainText("확정한 Docs·Sheets 보고서 내보내기 · 제한 사유 있음");
  await expect(page.getByRole("region", { name: "기능별 사용 조건" })).toContainText("코드 버전을 되돌려도 데이터가 복원되는 것은 아니에요");
  await expect(page.getByRole("region", { name: "Google 연결과 사용량" })).toContainText("재동의 필요");
  await page.getByText("메서드별 실제 요청과 예약 (1)", { exact: true }).click();
  await expect(page.getByRole("cell", { name: "SDK 조회 수 미확인" })).toBeVisible();
  await expect(page.getByRole("region", { name: "사이트와 저장 공간" })).toContainText("계정 전체 R2 잔여 용량, D1·Sites 제공사 한도는 미확인");
  await page.getByText(/weekly-report · 일부 반영/).click();
  await expect(page.getByRole("region", { name: "외부 작업별 반영 상태" })).toContainText("결과 불명 · 기록된 시도 2회");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, ".learning-dashboard", info);
  await page.screenshot({ path: `outputs/usage-${info.project.name}.png`, fullPage: true });
  data = { ...data, asOf: Date.now() - 61_000 };
  await page.getByRole("button", { name: "사용량 원장 새로 읽기" }).click();
  await expect(page.getByRole("status")).toContainText("이 사용량은 이전 조회 결과");
  status = 503; await page.getByRole("button", { name: "사용량 원장 새로 읽기" }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP 503");
  await expect(page.getByRole("region", { name: "AI 예산과 결제" })).toHaveCount(0);
  status = 200; data = { ...data, asOf: Date.now() }; await page.getByRole("button", { name: "사용량 원장 새로 읽기" }).click();
  await expect(page.getByText(/fixture@example.test/)).toBeVisible();
  status = 401;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(page.getByText(/fixture@example.test/)).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  await expect(page.getByRole("alert")).toContainText("HTTP 401");
  expect(requests).toBeGreaterThanOrEqual(5); expect(await page.pageErrors()).toEqual([]);
});
