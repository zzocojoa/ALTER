import { fixtureTutorBudget } from "./tutor-budget";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import type { TutorState } from "../../lib/tutor/contracts";
import { tutorAnswer } from "../../lib/tutor/contracts";
import { tutorAction } from "../../lib/tutor/request";
import { saveTutorDraft, saveTutorAnswer } from "../../lib/tutor/state";
import { publicTutorView } from "../../lib/tutor/view";

export type TutorInputFixture = Readonly<{ read: () => TutorState; actions: string[] }>;
/** 기존 상태 전이로 입력을 저장하고 허용하지 않은 AI 요청을 거부합니다. */
export async function mountTutorInput(page: Page, initial: TutorState): Promise<TutorInputFixture> {
  let state: TutorState = initial;
  const actions: string[] = [];
  const script: string = await readFile(".sites-runtime/tutor-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/tutor-browser/fixture.css", "utf8");
  await page.route("https://tutor.local.test/**", async (route): Promise<void> => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/dashboard/usage") { await route.fulfill({ json: fixtureTutorBudget(Date.now()) }); return; }
    if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: script }); return; }
    if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (url.pathname === "/api/tutor") {
      if (route.request().method() === "POST") {
        const input = tutorAction.parse(route.request().postDataJSON()); actions.push(input.action);
        if (input.action === "draft") state = saveTutorDraft(state, input.draft);
        else if (input.action === "submit") state = saveTutorAnswer({ ...state, draft: input.draft }, tutorAnswer.parse({ id: input.answerId, attemptId: state.question.attemptId, questionId: state.question.id, ...input.draft, helped: false, submittedAt: Date.now() }));
        else throw new Error(`입력 검사에서 허용하지 않은 요청: ${input.action}`);
      }
      await route.fulfill({ json: publicTutorView(state) }); return;
    }
    const view = publicTutorView(state);
    const data: string = JSON.stringify({ overview: { history: [{ id: view.id, title: view.title, version: view.version, phase: view.phase }], scopes: [] }, view }).replaceAll("<", "\\u003c");
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>답안 입력 검사</title><link rel="stylesheet" href="/fixture.css"></head><body><main><h1>한 걸음 수업</h1><div id="tutor-fixture"></div><script type="application/json" id="tutor-initial">${data}</script><script src="/fixture.js"></script></main></body></html>` });
  });
  await page.goto(`https://tutor.local.test/learn/tutor?id=${state.id}`);
  await expect(page.getByRole("region", { name: "현재 수업", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "최신 수업 기록 확인", exact: true })).toBeEnabled();
  return { read: (): TutorState => state, actions };
}
