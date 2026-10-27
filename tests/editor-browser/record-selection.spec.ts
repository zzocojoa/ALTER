import { fixtureTutorBudget } from "../fixtures/tutor-budget";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { publicEditorView } from "../../lib/editor/view";
import { editorWaitingFixture } from "../fixtures/editor-state";
import { tutorId } from "../fixtures/tutor-state";

test("새 첨삭이 초기 이력에 없어도 현재 기록을 선택 항목으로 표시한다", async ({ page }): Promise<void> => {
  const view = publicEditorView(editorWaitingFixture());
  const script: string = await readFile(".sites-runtime/editor-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/editor-browser/fixture.css", "utf8");
  const data: string = JSON.stringify({ overview: { history: [{ id: tutorId(999), title: "이전 첨삭", version: 1, phase: "finished" }], scopes: [] }, view }).replaceAll("<", "\\u003c");
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://record-menu.local.test" || route.request().method() !== "GET") throw new Error("기록 선택 검사에서 허용하지 않은 요청");
    if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (url.pathname === "/api/dashboard/usage") { await route.fulfill({ json: fixtureTutorBudget(Date.now()) }); return; }
    if (url.pathname === "/api/editor") { await route.fulfill({ json: view }); return; }
    if (url.pathname.startsWith("/api/")) throw new Error("기록 선택 검사에서 예상하지 않은 조회");
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>첨삭 기록 선택</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="editor-fixture"></main><script type="application/json" id="editor-initial">${data}</script><script src="/fixture.js"></script></body></html>` });
  });
  await page.goto("https://record-menu.local.test/learn/editor");
  const menu = page.getByRole("combobox", { name: "개선 기록", exact: true });
  await expect(menu).toHaveValue(view.tutor.id);
  await expect(menu.locator("option:checked")).toHaveText(`${view.tutor.title} · 기록 ${view.tutor.version}판`);
  await expect(menu.locator("option")).toHaveCount(2);
});
