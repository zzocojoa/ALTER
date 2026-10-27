import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { tutorStateFixture, tutorLessonFixture } from "../fixtures/tutor-state";
import { beginTutorLesson, finishTutorLesson, beginTutorRecall, saveTutorDraft } from "../../lib/tutor/state";
import { publicTutorView } from "../../lib/tutor/view";
import { checkAccessibility } from "../fixtures/accessibility";

/** 저장된 서버 초안의 배치만 확인하며 쓰기·AI 요청은 허용하지 않습니다. */
test("현재 질문·답안이 기록 선택보다 먼저 나오고 재진입·화면 크기 변경에도 같은 초안을 읽는다", async ({ page }, info) => {
  const state = saveTutorDraft(beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture())), { text: "전체를 같은 크기로 나눈 부분입니다.", fileIds: [] });
  const view = publicTutorView(state); const writes: string[] = [];
  const script: string = await readFile(".sites-runtime/tutor-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/tutor-browser/fixture.css", "utf8");
  await page.route("https://tutor.local.test/**", async (route): Promise<void> => {
    const url = new URL(route.request().url());
    if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (route.request().method() === "POST") { writes.push(url.pathname); throw new Error("화면 배치 검사는 쓰기 요청을 실행하면 안 돼요."); }
    if (url.pathname === "/api/tutor") { await route.fulfill({ json: view }); return; }
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tutor 화면 검사</title><link rel="stylesheet" href="/fixture.css"></head><body><main><h1>한 걸음 수업</h1><div id="tutor-fixture"></div><script type="application/json" id="tutor-initial">${JSON.stringify({ overview: { history: [{ id: view.id, title: view.title, version: view.version, phase: view.phase }], scopes: [] }, view }).replaceAll("<", "\\u003c")}</script><script src="/fixture.js"></script></main></body></html>` });
  });
  await page.goto(`https://tutor.local.test/learn/tutor?id=${view.id}#tutor-answer`);
  await expect(page.getByTestId("tutor-question")).toHaveCount(1);
  await expect(page.getByLabel("나의 답안", { exact: true })).toHaveValue(state.draft.text);
  const answerBox = await page.getByLabel("나의 답안", { exact: true }).boundingBox();
  const controls = await page.getByRole("region", { name: "수업 기록 선택과 다시 읽기", exact: true }).boundingBox();
  expect(answerBox).not.toBeNull(); expect(controls).not.toBeNull(); expect(answerBox!.y).toBeLessThan(controls!.y);
  await expect(page.getByRole("button", { name: "답안 제출·저장", exact: true })).toBeEnabled();
  await expect(page.locator("blockquote")).toHaveCount(0); await expect(page.getByRole("button", { name: "저장한 답안 진단", exact: true })).toHaveCount(0);
  await page.getByLabel("나의 답안", { exact: true }).focus(); await page.setViewportSize({ width: 768, height: 650 });
  await expect(page.getByLabel("나의 답안", { exact: true })).toBeFocused(); await expect(page.getByLabel("나의 답안", { exact: true })).toHaveValue(state.draft.text);
  await page.setViewportSize(info.project.name === "mobile-chromium" ? { width: 360, height: 800 } : { width: 1280, height: 720 });
  await page.reload(); await expect(page.getByLabel("나의 답안", { exact: true })).toHaveValue(state.draft.text); expect(page.url()).toContain("#tutor-answer");
  // 기존 자동 저장 주기보다 기다려도 읽어온 초안을 다시 쓰지 않아야 합니다.
  await page.waitForTimeout(1000); expect(writes).toEqual([]);
  await checkAccessibility(page, ".tutor-workspace", info);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await page.pageErrors()).toEqual([]);
  await page.screenshot({ path: `outputs/ui-tutor/layout-m1-${info.project.name}.png`, fullPage: true });
});
