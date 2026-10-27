import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { resultFixture } from "./result-state";
import { calculateResult } from "../../lib/results/evidence";
import { resultDraft, type ResultDraft } from "../../lib/results/contracts";

export function resultDraftFixture(): ResultDraft {
  const input = resultFixture(); const state = input.states[0];
  return resultDraft.parse({ id: state.id, version: state.version, sessionVersion: 1, title: "분수", editor: false, phase: state.phase, officialVersion: 0, fingerprint: "a".repeat(64), judgment: calculateResult(input), helpCount: 0, errors: [], canConfirm: true, issues: [], confirmation: null, latest: null, reviews: [] });
}
/** 읽기 전용 합성 결과 화면에서 쓰기를 발견하면 즉시 실패합니다. */
export async function mountResultView(page: Page, draft: ResultDraft): Promise<void> {
  const script: string = await readFile(".sites-runtime/result-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/result-browser/fixture.css", "utf8");
  await page.route("https://result.local.test/**", async (route): Promise<void> => {
    const url: URL = new URL(route.request().url());
    if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (url.pathname === "/api/results") { expect(route.request().method()).toBe("GET"); await route.fulfill({ json: draft }); return; }
    const data: string = JSON.stringify(draft).replaceAll("<", "\\u003c");
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>결과 구분 검사</title><link rel="stylesheet" href="/fixture.css"><body><main id="result-fixture"></main><script id="result-initial" type="application/json">${data}</script><script src="/fixture.js"></script></body></html>` });
  });
  await page.goto(`https://result.local.test/learn/results?id=${draft.id}`);
  await expect(page.getByRole("heading", { name: draft.title, exact: true })).toBeVisible();
}
