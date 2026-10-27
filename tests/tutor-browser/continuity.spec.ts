import { expect, test } from "@playwright/test";
import { beginTutorRecall, beginTutorLesson, finishTutorLesson, saveTutorDraft } from "../../lib/tutor/state";
import { tutorAction } from "../../lib/tutor/request";
import { publicTutorView } from "../../lib/tutor/view";
import { tutorStateFixture, tutorLessonFixture, tutorId } from "../fixtures/tutor-state";
import { mountTutorInput } from "../fixtures/tutor-input-browser";

/** 느린 초안 저장이 편집 중 문자열과 초점을 바꾸지 않는지 관찰합니다. */
test("자동 저장 응답 대기 중 입력·화면 크기 변경을 이어가고 최신 문자열을 저장한다", async ({ page }) => {
  const state = beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture()));
  const fixture = await mountTutorInput(page, state); const hold = Promise.withResolvers<void>(); const started = Promise.withResolvers<void>(); let first: boolean = true;
  await page.route("https://tutor.local.test/api/tutor", async (route): Promise<void> => {
    if (route.request().method() === "POST" && first) { first = false; started.resolve(); await hold.promise; } await route.fallback();
  });
  const answer = page.getByRole("textbox", { name: "나의 답안", exact: true }); await answer.fill("먼저 입력한 문장"); await started.promise;
  await expect(answer).toBeEnabled(); await expect(answer).toBeFocused(); await answer.fill("응답을 기다리며 이어 쓴 최신 한글 문장");
  await page.setViewportSize({ width: 768, height: 320 }); await expect(answer).toBeFocused(); hold.resolve();
  await expect.poll(() => fixture.read().draft.text).toBe("응답을 기다리며 이어 쓴 최신 한글 문장"); await expect(answer).toHaveValue("응답을 기다리며 이어 쓴 최신 한글 문장"); await expect(answer).toBeFocused();
  expect(fixture.actions).toEqual(["draft", "draft"]); await page.reload(); await expect(answer).toHaveValue("응답을 기다리며 이어 쓴 최신 한글 문장");
});

test("다른 회차·과거 버전의 조회와 쓰기 응답을 입력에 적용하지 않는다", async ({ page }) => {
  const state = saveTutorDraft(beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture())), { text: "보존할 초안", fileIds: [] });
  const fixture = await mountTutorInput(page, state);
  const view = publicTutorView(state); let response = { ...view, id: tutorId(999) };
  await page.route("https://tutor.local.test/api/tutor**", async (route): Promise<void> => { await route.fulfill({ json: response }); });
  const refresh = page.getByRole("button", { name: "최신 수업 기록 확인", exact: true }); const answer = page.getByRole("textbox", { name: "나의 답안", exact: true });
  await refresh.click(); await expect(page.getByRole("alert")).toContainText("다른 기록"); await expect(answer).toHaveValue("보존할 초안");
  response = { ...view, version: view.version - 1 }; await refresh.click(); await expect(page.getByRole("alert")).toContainText("이전 수업 버전"); await expect(answer).toHaveValue("보존할 초안");
  response = { ...view, id: tutorId(999) }; await answer.fill("쓰기 응답이 달라도 남길 초안"); await expect(page.getByRole("alert")).toContainText("다른 기록");
  await expect(answer).toHaveValue("쓰기 응답이 달라도 남길 초안"); await expect(page.getByText("저장 결과가 아직 확인되지 않았어요", { exact: true })).toBeVisible(); expect(fixture.actions).toEqual([]);
});

test("탭 전환 전에 시작한 조회가 돌아와도 가림을 해제하지 않고 최신 조회를 기다린다", async ({ page }) => {
  const state = saveTutorDraft(beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture())), { text: "처음 서버 초안", fileIds: [] });
  await mountTutorInput(page, state);
  const first = Promise.withResolvers<void>(); const second = Promise.withResolvers<void>(); let reads: number = 0;
  await page.route("https://tutor.local.test/api/tutor**", async (route): Promise<void> => {
    reads += 1;
    if (reads === 1) { await first.promise; await route.fulfill({ json: publicTutorView(state) }); return; }
    await second.promise; await route.fulfill({ json: publicTutorView(saveTutorDraft(state, { text: "다시 확인한 서버 초안", fileIds: [] })) });
  });
  await page.getByRole("button", { name: "최신 수업 기록 확인", exact: true }).click(); await expect.poll(() => reads).toBe(1);
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  await expect(page.getByTestId("tutor-question")).toHaveCount(0); first.resolve(); await expect.poll(() => reads).toBe(2);
  await expect(page.getByTestId("tutor-question")).toHaveCount(0); second.resolve();
  await expect(page.getByRole("textbox", { name: "나의 답안", exact: true })).toHaveValue("다시 확인한 서버 초안"); await expect(page.getByTestId("tutor-question")).toHaveCount(1);
});

test("재인증 실패 뒤 기존 답안과 질문을 숨기고 재확인 성공 때만 복원한다", async ({ page }) => {
  const state = saveTutorDraft(beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture())), { text: "소유자 답안", fileIds: [] });
  await mountTutorInput(page, state); let allowed: boolean = false;
  await page.route("https://tutor.local.test/api/tutor**", async (route): Promise<void> => {
    if (!allowed) { await route.fulfill({ status: 403, json: { error: "forbidden", message: "소유자 확인 필요" } }); return; } await route.fallback();
  });
  await page.getByRole("button", { name: "최신 수업 기록 확인", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("소유자 확인 필요");
  await expect(page.getByRole("textbox")).toHaveCount(0); await expect(page.getByTestId("tutor-question")).toHaveCount(0); expect(await page.locator(".tutor-workspace").textContent()).not.toContain("소유자 답안");
  allowed = true; await page.getByRole("button", { name: "최신 수업 기록 확인", exact: true }).click(); await expect(page.getByRole("textbox", { name: "나의 답안", exact: true })).toHaveValue("소유자 답안");
});


test("자동 저장 중 새 입력이 생긴 뒤 응답을 잃어도 재조회 후 최신 입력을 따로 저장한다", async ({ page }) => {
  let state = beginTutorRecall(finishTutorLesson(beginTutorLesson(tutorStateFixture()), tutorLessonFixture()));
  await mountTutorInput(page, state); const started = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>(); let writes: number = 0;
  await page.route("https://tutor.local.test/api/tutor**", async (route): Promise<void> => {
    if (route.request().method() === "POST") {
      const input = tutorAction.parse(route.request().postDataJSON()); if (input.action !== "draft") throw new Error("초안 저장 이외의 요청은 허용하지 않습니다.");
      expect(input.expectedVersion).toBe(state.version); writes += 1;
      if (writes === 1) { started.resolve(); await release.promise; state = saveTutorDraft(state, input.draft); await route.abort("failed"); return; }
      state = saveTutorDraft(state, input.draft);
    }
    await route.fulfill({ json: publicTutorView(state) });
  });
  const answer = page.getByRole("textbox", { name: "나의 답안", exact: true }); await answer.fill("먼저 보낸 초안"); await started.promise; await answer.fill("저장 중 계속 입력한 최신 초안"); release.resolve();
  await expect(page.getByText("저장 결과가 아직 확인되지 않았어요", { exact: true })).toBeVisible(); await expect(answer).toHaveValue("저장 중 계속 입력한 최신 초안");
  await page.getByRole("button", { name: "최신 수업 기록 확인", exact: true }).click();
  await expect.poll(() => state.draft.text).toBe("저장 중 계속 입력한 최신 초안"); await expect(answer).toHaveValue("저장 중 계속 입력한 최신 초안"); expect(writes).toBe(2); expect(state.answers).toHaveLength(0);
});
