import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { checkAccessibility } from "../fixtures/accessibility";
import { fixtureUsageDashboard } from "../fixtures/dashboard-usage";

test("일반 홈과 기존 확인 링크를 분리하고 진단은 진입만으로 실행하지 않는다", async ({ page }, info) => {
  const script: string = await readFile(".sites-runtime/dashboard-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/dashboard-browser/fixture.css", "utf8");
  const api: string[] = [];
  await page.route("https://home.local.test/**", async (route): Promise<void> => {
    const request = route.request();
    const path: string = new URL(request.url()).pathname;
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (path.startsWith("/api/")) api.push(request.method() + " " + path);
    expect(request.method()).toBe("GET");
    if (path === "/api/dashboard") { await route.fulfill({ json: { asOf: Date.now(), today: "2026-10-27", revision: "fixture", visibility: "visible", scopes: [], sessions: [], reviews: [], results: [], legacyReviews: 0 } }); return; }
    if (path === "/api/dashboard/usage") { await route.fulfill({ json: fixtureUsageDashboard(Date.now()) }); return; }
    expect(["/learn", "/learn/diagnostics", "/learn/advisor"]).toContain(path);
    await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="dashboard-fixture"></div><script src="/fixture.js"></script></html>' });
  });
  await page.goto("https://home.local.test/learn");
  await expect(page.getByRole("heading", { name: "이어갈 학습이 아직 없어요", exact: true })).toBeVisible();
  await expect(page.getByText("AI 연결 확인", { exact: true })).toHaveCount(0);
  await expect(page.getByText("사용량·연결 상태 확인", { exact: true })).toHaveCount(0);
  expect(api).toEqual(["GET /api/dashboard"]);
  await page.goto("https://home.local.test/learn?check=budget#check-budget");
  const budget = page.locator("#check-budget");
  await expect(budget).toContainText("원화 청구 미확정");
  await expect(budget).toBeFocused();
  await expect(page.locator(".usage-disclosure")).toHaveAttribute("open", "");
  await page.goto("https://home.local.test/learn?check=progress#check-progress");
  await expect(page.locator("#check-progress")).toBeFocused();
  await expect(page.getByText("사용량·연결 상태 확인", { exact: true })).toHaveCount(0);
  await page.goto("https://home.local.test/learn#check-old-unknown");
  await expect(page.getByRole("region", { name: "기존 확인 링크 안내", exact: true })).toContainText("찾지 못했어요");
  await expect(page.getByRole("link", { name: "소유자 진단 열기", exact: true })).toHaveAttribute("href", "/learn/diagnostics");
  const beforeDiagnostics: number = api.length;
  await page.getByRole("link", { name: "소유자 진단 열기", exact: true }).click();
  await expect(page.getByText("AI 연결 확인", { exact: true })).toBeVisible();
  await page.getByText("AI 연결 확인", { exact: true }).click();
  await expect(page.getByRole("button", { name: "AI 연결 검사 (API 비용 발생)", exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  expect(api.length).toBe(beforeDiagnostics);
  await expect(page.getByRole("navigation", { name: "검사 도구 찾기" })).toBeVisible();
  await expect(page.getByRole("link", { name: "복습 검사", exact: true })).toHaveAttribute("href", "/learn/tutor#diagnostic-reviews");
  await expect(page.getByText("Google 고정 검사는 현재 서버에서 활성화되지 않았어요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Google 연결·전송 검사", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "진단과 학습계획 검사", exact: true }).click();
  await expect(page.locator("#diagnostic-advisor")).toHaveAttribute("open", ""); await expect(page.locator("#diagnostic-advisor")).toBeFocused();
  await expect(page.getByRole("button", { name: "시험 상태 확인", exact: true })).toBeVisible();
  await page.getByText("고급 · 소유자 진단 — 진단과 학습계획", { exact: true }).click(); await expect(page.getByRole("button", { name: "시험 상태 확인", exact: true })).not.toBeVisible();
  await page.goto("https://home.local.test/learn/advisor"); await expect(page.getByRole("button", { name: "시험 상태 확인", exact: true })).not.toBeVisible();
  await page.getByText("고급 · 소유자 진단 — 진단과 학습계획", { exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "시험 상태 확인", exact: true })).toBeVisible(); expect(api.length).toBe(beforeDiagnostics);
  await checkAccessibility(page, "main", info); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.pageErrors()).toEqual([]);
});
