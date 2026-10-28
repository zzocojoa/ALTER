import { fixtureTutorBudget } from "./tutor-budget";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import type { EditorView } from "../../lib/editor/view";

/** 저장된 화면만 제공하며 뜻하지 않은 쓰기는 검사 실패로 드러냅니다. */
export async function mountEditorView(page: Page, view: EditorView): Promise<void> {
  const script: string = await readFile(".sites-runtime/editor-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/editor-browser/fixture.css", "utf8");
  await page.route("https://editor.local.test/**", async (route): Promise<void> => {
    const url: URL = new URL(route.request().url());
    if (route.request().method() !== "GET") throw new Error(`화면 확인 중 쓰기 요청: ${url.pathname}`);
    if (url.pathname === "/api/dashboard/usage") { await route.fulfill({ json: fixtureTutorBudget(Date.now()) }); return; }
    if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: script }); return; }
    if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (url.pathname === "/api/editor") { await route.fulfill({ json: view }); return; }
    const overview = { history: [{ id: view.tutor.id, version: view.tutor.version, title: view.tutor.title, phase: view.tutor.phase }], scopes: [] };
    const data: string = JSON.stringify({ overview, view }).replaceAll("<", "\\u003c");
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>첨삭 화면 검사</title><link rel="stylesheet" href="/fixture.css"><body><main id="editor-fixture"></main><script id="editor-initial" type="application/json">${data}</script><script src="/fixture.js"></script></body></html>` });
  });
  await page.goto("https://editor.local.test/");
  await expect(page.getByRole("button", { name: "최신 개선 기록 확인", exact: true })).toBeEnabled();
}
