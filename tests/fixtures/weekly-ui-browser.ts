import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { weeklyPlanFixture } from "./weekly-plan";
import { weeklyWorkspace } from "../../lib/weekly/workspace";
import type { WeeklyView } from "../../lib/weekly/view";
import { tutorId } from "./tutor-state";

export async function weeklyViewFixture(): Promise<WeeklyView> {
  const { context, proposal } = await weeklyPlanFixture();
  const state = weeklyWorkspace.parse({ id: tutorId(1300), courseId: context.aggregate.courseId, date: "2026-10-25", version: 1, context, fingerprint: "a".repeat(64), phase: "proposed", proposal, claims: [], notes: "저장된 개선 메모", pendingKey: null, confirmedVersionId: null });
  return { state, current: true, issue: null, versions: [], generationRecovery: { allowed: false, reason: "생성 중인 초안이 아니에요." } };
}

export async function mountWeeklyView(page: Page, data: WeeklyView): Promise<void> {
  const script = await readFile(".sites-runtime/weekly-browser/fixture.iife.js", "utf8");
  const css = await readFile(".sites-runtime/weekly-browser/fixture.css", "utf8");
  await page.route("https://weekly.ui.test/**", async (route): Promise<void> => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (path === "/api/weekly") { expect(route.request().method()).toBe("GET"); await route.fulfill({ json: data }); return; }
    if (path.startsWith("/api/")) throw new Error(`의도하지 않은 외부 요청: ${path}`);
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>주간 화면 검사</title><link rel="stylesheet" href="/fixture.css"><main id="weekly-fixture"></main><script id="weekly-initial" type="application/json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="/fixture.js"></script></html>` });
  });
  await page.goto("https://weekly.ui.test/learn/weekly");
  await expect(page.getByRole("heading", { name: "2026-10-19 주간", exact: true })).toBeVisible();
}
