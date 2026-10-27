import { readFile } from "node:fs/promises";
import type { Page, Route } from "@playwright/test";
import type { ExternalWorkflowState } from "../../lib/external/state";
import type { GoogleReportClientView } from "../../lib/google-report/client";

export const reportVersionId: string = "00000000-0000-4000-8000-000000001396";
export const reportWorkflowId: string = "00000000-0000-4000-8000-000000001397";
export function reportStatusFixture(state: ExternalWorkflowState, connected: boolean): GoogleReportClientView {
  return { versionId: reportVersionId, connected, workflow: { id: reportWorkflowId, state, operations: [{ kind: "document-write", state: "confirmed" }, { kind: "report-row-append", state: state === "partial" ? "pending" : state }] }, documentUrl: "https://docs.google.com/document/d/fixture-report/edit", spreadsheetUrl: state === "confirmed" ? "https://docs.google.com/spreadsheets/d/fixture-report/edit" : null };
}
export async function mountGoogleReport(page: Page, handler: (route: Route, path: string) => Promise<void>): Promise<void> {
  const script = await readFile(".sites-runtime/google-report-browser/fixture.iife.js", "utf8"); const css = await readFile(".sites-runtime/google-report-browser/fixture.css", "utf8");
  await page.route("https://report.status.test/**", async (route): Promise<void> => {
    const url = new URL(route.request().url());
    if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (url.pathname.startsWith("/api/")) { await handler(route, url.pathname); return; }
    await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>보고서 연동 검사</title><link rel="stylesheet" href="/fixture.css"><main id="google-fixture"></main><script src="/fixture.js"></script></html>' });
  });
  await page.goto("https://report.status.test/fixture?panel=report");
}
