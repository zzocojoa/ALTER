import { fixtureTutorBudget } from "../fixtures/tutor-budget";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { beginTutorLesson, finishTutorLesson, beginTutorRecall } from "../../lib/tutor/state";
import { publicTutorView } from "../../lib/tutor/view";
import { tutorStateFixture, tutorLessonFixture, tutorId } from "../fixtures/tutor-state";
import { mountTutorInput } from "../fixtures/tutor-input-browser";

const recall = (): ReturnType<typeof beginTutorRecall> => beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture()));

test("새 수업이 초기 이력에 없어도 현재 기록을 선택 항목으로 표시한다", async ({ page }): Promise<void> => {
  const view = publicTutorView(recall());
  const script: string = await readFile(".sites-runtime/tutor-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/tutor-browser/fixture.css", "utf8");
  const data: string = JSON.stringify({ overview: { history: [{ id: tutorId(999), title: "이전 수업", version: 1, phase: "finished" }], scopes: [] }, view }).replaceAll("<", "\\u003c");
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "https://record-menu.local.test" || route.request().method() !== "GET") throw new Error("기록 선택 검사에서 허용하지 않은 요청");
    if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (url.pathname === "/api/dashboard/usage") { await route.fulfill({ json: fixtureTutorBudget(Date.now()) }); return; }
    if (url.pathname === "/api/tutor") { await route.fulfill({ json: view }); return; }
    if (url.pathname.startsWith("/api/")) throw new Error("기록 선택 검사에서 예상하지 않은 조회");
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>수업 기록 선택</title><link rel="stylesheet" href="/fixture.css"></head><body><main id="tutor-fixture"></main><script type="application/json" id="tutor-initial">${data}</script><script src="/fixture.js"></script></body></html>` });
  });
  await page.goto("https://record-menu.local.test/learn/tutor");
  const menu = page.getByRole("combobox", { name: "수업 기록", exact: true });
  await expect(menu).toHaveValue(view.id);
  await expect(menu.locator("option:checked")).toHaveText(`${view.title} · 기록 ${view.version}판`);
  await expect(menu.locator("option")).toHaveCount(2);
});

test("답안 초안 저장 후 기록 선택 항목도 최신 판 번호를 표시한다", async ({ page }): Promise<void> => {
  const fixture = await mountTutorInput(page, recall());
  await page.getByRole("textbox", { name: "나의 답안", exact: true }).fill("분수는 전체의 일부입니다.");
  await expect.poll(() => fixture.actions).toContain("draft");
  const menu = page.getByRole("combobox", { name: "수업 기록", exact: true });
  await expect(menu.locator("option:checked")).toHaveText(`${publicTutorView(fixture.read()).title} · 기록 ${fixture.read().version}판`);
});
