import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { checkAccessibility } from "../fixtures/accessibility";
import { recordId } from "../../lib/domain/contracts";
import type { LearningDashboard } from "../../lib/dashboard/contracts";

const id = recordId.parse("00000000-0000-4000-a000-000000000017");
const reviewId = recordId.parse("00000000-0000-4000-a000-000000000018");

test("오늘의 다섯 목표와 계획·수행 지표는 실제 저장값에 연결된다", async ({ page }, info) => {
  const script: string = await readFile(".sites-runtime/dashboard-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/dashboard-browser/fixture.css", "utf8");
  const data: LearningDashboard = { asOf: Date.now(), today: "2026-10-27", revision: "ready-fixture", visibility: "visible", scopes: [{ id, version: 2, title: "분수의 의미", course: "분수 첫걸음", date: "2026-10-27", phase: "confirmed", minutes: 30, current: true }], sessions: [{ id, version: 3, title: "분수의 의미", course: "분수 첫걸음", kind: "tutor", phase: "awaiting-answer" }], reviews: [{ id: reviewId, title: "같은 분모 덧셈", dueDate: "2026-10-27", dueState: "today", sessionId: null }], legacyReviews: 0, results: [{ title: "분수의 의미", course: "분수 첫걸음", sessionId: id, record: { unitId: id, resultVersionId: id, progress: "완료", performance: "도움받아 수행", correctionId: null, nextAction: "새 예시를 도움 없이 설명하기" } }] };
  const requests: string[] = [];
  await page.route("https://shortcuts.local.test/**", async (route): Promise<void> => {
    const request = route.request();
    const path: string = new URL(request.url()).pathname;
    requests.push(request.method() + " " + path);
    expect(request.method()).toBe("GET");
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (path === "/api/dashboard") { await route.fulfill({ json: { ...data, asOf: Date.now() } }); return; }
    expect(path).toBe("/learn");
    await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="dashboard-fixture"></div><script src="/fixture.js"></script></html>' });
  });
  await page.goto("https://shortcuts.local.test/learn");
  const shortcuts = page.getByRole("region", { name: "학습 바로가기", exact: true });
  await expect(shortcuts.getByRole("link")).toHaveCount(5);
  const targets = [["자료 원본 열기", "/learn/materials"], ["답안 쓰기", `/learn/tutor?id=${id}#tutor-answer-area`], ["답안 제출", `/learn/tutor?id=${id}#tutor-answer-area`], ["오늘 복습 시작", `/learn/tutor#review-${reviewId}`], ["확정 기록 찾기", "/learn/results"]] as const;
  for (const [title, href] of targets) await expect(shortcuts.getByRole("link", { name: new RegExp(title) })).toHaveAttribute("href", href);
  const metrics = page.getByRole("region", { name: "진도와 수행 요약", exact: true });
  await expect(metrics.locator("dd")).toHaveText(["30분", "1개", "0개"]);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(shortcuts.getByRole("link")).toHaveCount(5);
  }
  await page.setViewportSize({ width: 320, height: 600 });
  await page.evaluate((): void => { document.documentElement.style.fontSize = "200%"; });
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, ".learning-dashboard", info);
  await page.evaluate((): void => { document.documentElement.style.removeProperty("font-size"); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("h1").click();
  await page.screenshot({ path: `outputs/today-ready-${info.project.name}.png`, fullPage: true });
  expect(requests.filter((request): boolean => request.includes("/api/")).every((request): boolean => request === "GET /api/dashboard")).toBe(true);
  expect(await page.pageErrors()).toEqual([]);
});
