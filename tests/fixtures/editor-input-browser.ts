import { fixtureTutorBudget } from "./tutor-budget";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { canonicalJson } from "../../lib/domain/contracts";
import { editorAction, type EditorAction } from "../../lib/editor/actions";
import { publicEditorView, type EditorView } from "../../lib/editor/view";
import { saveEditorRevisionDraft, submitEditorRevision } from "../../lib/editor/revision";
import type { TutorState } from "../../lib/tutor/contracts";

type EditorInputFixture = Readonly<{ read: () => TutorState; replace: (next: TutorState) => void; requests: Readonly<{ key: string; input: EditorAction }>[] }>;
/** 저장 요청만 실제 도메인 전이로 처리하고 같은 키의 영수증은 같은 결과를 반환합니다. */
export async function mountEditorInput(page: Page, initial: TutorState): Promise<EditorInputFixture> {
  let state: TutorState = initial;
  const requests: { key: string; input: EditorAction }[] = [];
  const receipts = new Map<string, Readonly<{ body: string; view: EditorView }>>();
  const script: string = await readFile(".sites-runtime/editor-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/editor-browser/fixture.css", "utf8");
  await page.route("https://editor.local.test/**", async (route): Promise<void> => {
    const url: URL = new URL(route.request().url());
    if (url.pathname === "/api/dashboard/usage") { await route.fulfill({ json: fixtureTutorBudget(Date.now()) }); return; }
    if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (url.pathname === "/api/editor") {
      if (route.request().method() === "POST") {
        const input = editorAction.parse(route.request().postDataJSON());
        const key: string | undefined = route.request().headers()["idempotency-key"];
        if (!key) throw new Error("저장 요청 키 없음");
        requests.push({ key, input });
        const receipt = receipts.get(key);
        if (receipt) { expect(receipt.body).toBe(canonicalJson(input)); await route.fulfill({ json: receipt.view }); return; }
        if ("expectedVersion" in input && input.expectedVersion !== state.version) { await route.fulfill({ status: 409, json: { error: "version_conflict", message: "최신 기록 확인 필요" } }); return; }
        if (input.action === "revision-draft") state = saveEditorRevisionDraft(state, input.draft, input.reason);
        else if (input.action === "revision-submit") state = submitEditorRevision(state, { answerId: input.answerId, attemptId: input.attemptId, draft: input.draft, reason: input.reason, submittedAt: 20 });
        else throw new Error(`입력 검사에서 허용하지 않은 요청: ${input.action}`);
        receipts.set(key, { body: canonicalJson(input), view: publicEditorView(state) });
      }
      await route.fulfill({ json: publicEditorView(state) }); return;
    }
    const view: EditorView = publicEditorView(state);
    const data: string = JSON.stringify({ overview: { history: [{ id: view.tutor.id, version: view.tutor.version, title: view.tutor.title, phase: view.tutor.phase }], scopes: [] }, view }).replaceAll("<", "\\u003c");
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>첨삭 저장 검사</title><link rel="stylesheet" href="/fixture.css"><body><main id="editor-fixture"></main><script id="editor-initial" type="application/json">${data}</script><script src="/fixture.js"></script></body></html>` });
  });
  await page.goto(`https://editor.local.test/learn/editor?id=${initial.id}`);
  await expect(page.getByRole("region", { name: "결과물 개선", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "최신 개선 기록 확인", exact: true })).toBeEnabled();
  return { read: (): TutorState => state, replace: (next): void => { state = next; }, requests };
}
