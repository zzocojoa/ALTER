import { readFile } from "node:fs/promises";
import { expect, type Page, type Route } from "@playwright/test";
import { weeklyViewFixture } from "./weekly-ui-browser";
import { validatedWeeklyDraft } from "../../lib/weekly/workspace";
import type { WeeklyFrozen } from "../../lib/weekly/view";
import { tutorId } from "./tutor-state";

export async function weeklyFrozenFixture(): Promise<WeeklyFrozen> {
  const view = await weeklyViewFixture(); const state = view.state;
  if (!state.proposal || state.context.availableMinutes === null) throw new Error("확정본 시험 초안 누락");
  const saved = validatedWeeklyDraft(state, { availableMinutes: state.context.availableMinutes, notes: state.notes, proposal: state.proposal });
  return { state: { ...saved, phase: "confirmed", version: 3, confirmedVersionId: tutorId(1999) }, confirmedAt: Date.parse("2026-10-25T12:00:00Z"), current: true, issue: null, exportState: "pending" };
}

export async function mountWeeklyFrozen(page: Page, data: WeeklyFrozen, read: (route: Route) => Promise<void>): Promise<void> {
  const script = await readFile(".sites-runtime/weekly-browser/fixture.iife.js", "utf8");
  const css = await readFile(".sites-runtime/weekly-browser/fixture.css", "utf8");
  await page.route("https://weekly.frozen.test/**", async (route): Promise<void> => {
    const url = new URL(route.request().url());
    if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (url.pathname === "/api/weekly") { expect(route.request().method()).toBe("GET"); expect(url.searchParams.get("version")).toBe(data.state.confirmedVersionId); await read(route); return; }
    if (url.pathname.startsWith("/api/")) throw new Error(`확정본에서 의도하지 않은 요청: ${url.pathname}`);
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>확정본 검사</title><link rel="stylesheet" href="/fixture.css"><div id="weekly-fixture"></div><script id="weekly-initial" type="application/json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="/fixture.js"></script></html>` });
  });
  await page.goto(`https://weekly.frozen.test/learn/weekly/version?id=${data.state.confirmedVersionId}&frozen=1`);
  await expect(page.getByRole("heading", { name: "2026-10-19 주간 확정본", exact: true })).toBeVisible();
}
