import { checkAccessibility } from "../fixtures/accessibility";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { recordId } from "../../lib/domain/contracts";
import type { LearningDashboard } from "../../lib/dashboard/contracts";
const id = recordId.parse("00000000-0000-4000-a000-000000000017");
const otherId = recordId.parse("00000000-0000-4000-a000-000000000018");
test("대시보드 복수 과정·조회 실패·인출 가림·뒤로가기·모바일", async ({ page }, info) => {
  const script = await readFile(".sites-runtime/dashboard-browser/fixture.iife.js", "utf8");
  const css = await readFile(".sites-runtime/dashboard-browser/fixture.css", "utf8");
  let status: number = 200;
  let data: LearningDashboard = { asOf: Date.now(), today: "2026-10-25", revision: "1:1", visibility: "visible", scopes: [], sessions: [], reviews: [], legacyReviews: 0, results: [
    { title: "분수 의미", course: "수학 과정", sessionId: id, record: { unitId: id, resultVersionId: id, progress: "완료", performance: "독립 수행", correctionId: null, nextAction: "새 조건 풀이" } },
    { title: "문장 쓰기", course: "글쓰기 과정", sessionId: otherId, record: { unitId: otherId, resultVersionId: otherId, progress: "진행 중", performance: "도움받아 수행", correctionId: null, nextAction: "수정 이유 쓰기" } }
  ] };
  await page.route("https://dashboard.local.test/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (path === "/api/dashboard") { expect(route.request().method()).toBe("GET"); await route.fulfill({ status, json: data }); return; }
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><main id="dashboard-fixture"></main><script src="/fixture.js"></script></html>' });
  });
  await page.goto("https://dashboard.local.test/learn");
  await expect(page.getByText("수학 과정", { exact: true })).toBeVisible();
  await expect(page.getByText("글쓰기 과정", { exact: true })).toBeVisible();
  await expect(page.getByText("독립 수행", { exact: true })).toBeVisible();
  await expect(page.getByText("도움받아 수행", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "확정 결과 확인하기" }).first()).toHaveAttribute("href", `/learn/results?id=${id}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page,".learning-dashboard",info);
  await page.screenshot({ path: `outputs/dashboard-${info.project.name}.png`, fullPage: true });
  data = { ...data, asOf: Date.now(), sessions: [{ id, version: 4, title: "분수의 의미", course: "분수 시험 계획", kind: "editor", phase: "answer-saved" }], reviews: [{ id: otherId, title: "분수 복습", dueDate: "2026-10-28", dueState: "proposed", sessionId: null }] };
  await page.goto("https://dashboard.local.test/learn#check-navigation");
  await page.reload();
  const guided = page.locator("#check-navigation");
  await expect(guided).toBeFocused();
  const resume = guided.getByRole("link", { name: /① 저장한 초안 열기/ });
  const review = guided.getByRole("link", { name: /② 복습 화면 열기/ });
  await expect(resume).toHaveAttribute("href", `/learn/editor?id=${id}#check-editor-saved`);
  await expect(review).toHaveAttribute("href", `/learn/tutor#check-review-${otherId}`);
  expect((await resume.boundingBox())?.height).toBeGreaterThanOrEqual(64);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, "#check-navigation", info);
  await page.screenshot({ path: `outputs/navigation-check-${info.project.name}.png`, fullPage: true });
  status = 503; await page.getByRole("button", { name: "최신 현황 읽기" }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP 503");
  await expect(page.getByText("새 조건 풀이", { exact: true })).toHaveCount(0);
  await expect(page.getByText("진행 중인 회차가 없어요.", { exact: true })).toHaveCount(0);
  status = 200; data = { ...data, asOf: Date.now(), visibility: "hidden-recall", results: [], sessions: [{ id, version: 1, title: "진행 중인 학습", course: "", kind: "tutor", phase: "awaiting-answer" }] };
  await page.getByRole("button", { name: "최신 현황 읽기" }).click();
  await expect(page.getByRole("link", { name: "이 회차 이어가기" })).toHaveAttribute("href", `/learn/tutor?id=${id}`);
  await expect(page.getByRole("heading", { name: "확정된 진도와 다음 행동" })).toHaveCount(0);
  data = { ...data, asOf: Date.now() - 61_000 };
  await page.getByRole("button", { name: "최신 현황 읽기" }).click();
  await expect(page.getByRole("status")).toContainText("조회한 지 시간이");
  await expect(page.getByRole("link", { name: "이 회차 이어가기" })).toHaveCount(0);
  status = 401;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  await expect(page.getByRole("alert")).toContainText("HTTP 401");
  expect(await page.pageErrors()).toEqual([]);
});
