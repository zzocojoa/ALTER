import { expect, test } from "@playwright/test";
import { editorAction } from "../../lib/editor/actions";
import { saveEditorRevisionDraft } from "../../lib/editor/revision";
import { publicEditorView } from "../../lib/editor/view";
import { editorWaitingFixture, editorReadyFixture } from "../fixtures/editor-state";
import { mountEditorInput } from "../fixtures/editor-input-browser";
import { tutorId } from "../fixtures/tutor-state";

test("느린 저장 중 긴 수정본·이유 편집을 계속하고 이력 왕복과 새로고침에 보존", async ({ page }): Promise<void> => {
  const fixture = await mountEditorInput(page, editorWaitingFixture());
  const started = Promise.withResolvers<void>(); const hold = Promise.withResolvers<void>(); let first: boolean = true;
  await page.route("**/api/editor", async (route): Promise<void> => { if (route.request().method() === "POST" && first) { first = false; started.resolve(); await hold.promise; } await route.fallback(); });
  const text = page.getByRole("textbox", { name: "나의 수정본", exact: true });
  await text.fill("저장 중인 첫 문장"); await started.promise;
  await expect(text).toBeEnabled(); await expect(text).toBeFocused();
  const long: string = "3/8입니다. 여덟 조각 중 세 조각입니다.\n".repeat(800);
  await text.fill(long); await page.getByRole("textbox", { name: "수정 이유", exact: true }).fill("전체와 부분을 구분한 이유입니다.");
  await page.getByText("초안·수정 이유 이력 (1)", { exact: true }).click();
  await expect(page.getByRole("article", { name: "원본 초안", exact: true })).toContainText("1/4은 네 조각");
  await page.getByRole("link", { name: "작성 중인 입력으로 돌아가기 ↑", exact: true }).click();
  await expect(text).toHaveValue(long); await page.setViewportSize({ width: 768, height: 320 }); hold.resolve();
  await expect.poll(() => fixture.read().draft.text).toBe(long);
  await expect.poll(() => fixture.read().editor?.draftReason).toBe("전체와 부분을 구분한 이유입니다.");
  expect(fixture.requests.map((item) => item.input.action)).toEqual(["revision-draft", "revision-draft"]);
  await page.reload(); await expect(text).toHaveValue(long); await expect(page.getByRole("textbox", { name: "수정 이유", exact: true })).toHaveValue("전체와 부분을 구분한 이유입니다.");
});

test("응답 유실은 동일 저장 키로만 확인하며 다른 입력을 자동 전송하지 않음", async ({ page }): Promise<void> => {
  const fixture = await mountEditorInput(page, editorWaitingFixture());
  let first: boolean = true; let lostKey: string = "";
  await page.route("**/api/editor", async (route): Promise<void> => { if (route.request().method() === "POST" && first) { first = false; lostKey = route.request().headers()["idempotency-key"]; await route.abort("failed"); return; } await route.fallback(); });
  await page.getByRole("textbox", { name: "수정 이유", exact: true }).fill("잃지 않을 수정 이유");
  await expect(page.getByText("저장 결과가 아직 확인되지 않았어요", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "수정 이유", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "최신 개선 기록 확인", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "수정 이유", exact: true })).toHaveValue("잃지 않을 수정 이유");
  await expect(page.getByRole("button", { name: "같은 저장 요청 다시 확인", exact: true })).toBeVisible();
  expect(fixture.requests).toHaveLength(0);
  await page.getByRole("button", { name: "같은 저장 요청 다시 확인", exact: true }).click();
  await expect(page.getByText("서버 초안 저장을 확인했어요", { exact: true })).toBeVisible();
  expect(fixture.requests).toHaveLength(1); expect(fixture.requests[0].key).toBe(lostKey);
});

test("늦은 조회와 다른 회차·과거 버전 응답이 입력을 덮어쓰지 못함", async ({ page }): Promise<void> => {
  const state = saveEditorRevisionDraft(editorWaitingFixture(), { text: "소유자 수정본", fileIds: [] }, "보존할 이유");
  await mountEditorInput(page, state);
  const view = publicEditorView(state);
  let response = { ...view, tutor: { ...view.tutor, id: tutorId(999) } };
  await page.route("**/api/editor**", async (route): Promise<void> => { await route.fulfill({ json: response }); });
  const refresh = page.getByRole("button", { name: "최신 개선 기록 확인", exact: true });
  await refresh.click(); await expect(page.getByRole("alert")).toContainText("다른 기록");
  response = { ...view, tutor: { ...view.tutor, version: view.tutor.version - 1 } };
  await refresh.click(); await expect(page.getByRole("alert")).toContainText("이전 수업 버전");
  await expect(page.getByRole("textbox", { name: "나의 수정본", exact: true })).toHaveValue("소유자 수정본");
  response = { ...view, tutor: { ...view.tutor, id: tutorId(999) } };
  await page.getByRole("textbox", { name: "수정 이유", exact: true }).fill("응답과 다른 현재 입력");
  await expect(page.getByText("저장 결과가 아직 확인되지 않았어요", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "수정 이유", exact: true })).toHaveValue("응답과 다른 현재 입력");
});

test("화면 복귀는 전환 뒤 새 조회를 기다리고 403 뒤에는 기록을 가림", async ({ page }): Promise<void> => {
  const fixture = await mountEditorInput(page, editorWaitingFixture());
  const first = Promise.withResolvers<void>(); const second = Promise.withResolvers<void>(); let reads: number = 0;
  await page.route("**/api/editor**", async (route): Promise<void> => { reads += 1; await (reads === 1 ? first.promise : second.promise); await route.fulfill({ json: publicEditorView(fixture.read()) }); });
  await page.getByRole("button", { name: "최신 개선 기록 확인", exact: true }).click(); await expect.poll(() => reads).toBe(1);
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  await expect(page.getByRole("textbox")).toHaveCount(0); first.resolve(); await expect.poll(() => reads).toBe(2); await expect(page.getByRole("textbox")).toHaveCount(0); second.resolve();
  await expect(page.getByRole("textbox", { name: "나의 수정본", exact: true })).toBeVisible();
  await page.route("**/api/editor**", async (route): Promise<void> => { await route.fulfill({ status: 403, json: { error: "forbidden", message: "소유자 재확인 필요" } }); });
  await page.getByRole("button", { name: "최신 개선 기록 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("소유자 재확인 필요");
  await expect(page.getByRole("textbox")).toHaveCount(0); await expect(page.getByRole("combobox")).toHaveCount(0);
  expect(await page.locator(".editor-workspace").textContent()).not.toContain("1/4은 네 조각");
});

test("펼친 버전·피드백 이력은 화면 복귀 후 유지되고 옛 확인 앵커도 열림", async ({ page }): Promise<void> => {
  await mountEditorInput(page, editorReadyFixture());
  await page.getByText("초안·수정 이유 이력 (2)", { exact: true }).click();
  await page.getByText("이전 피드백 이력 (1)", { exact: true }).click();
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  await expect(page.getByRole("article", { name: "원본 초안", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "초안 1판 피드백", exact: true })).toBeVisible();
  await page.reload(); await page.evaluate((): void => { window.location.hash = "check-editor-saved"; });
  await expect(page.locator("#check-editor-saved")).toBeFocused(); await expect(page.locator("#check-editor-saved details")).toHaveAttribute("open", "");
  await page.getByRole("link", { name: "이 수정의 기준 피드백으로 이동", exact: true }).click();
  await expect(page.getByRole("article", { name: "초안 1판 피드백", exact: true })).toBeVisible();
  expect(await page.pageErrors()).toEqual([]);
});


test("미확정 초안의 저장을 확인해도 전송 중 새로 쓴 입력을 지우지 않음", async ({ page }): Promise<void> => {
  const fixture = await mountEditorInput(page, editorWaitingFixture());
  const started = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>(); let writes: number = 0;
  await page.route("**/api/editor**", async (route): Promise<void> => {
    if (route.request().method() === "POST") {
      writes += 1;
      if (writes === 1) {
        const input = editorAction.parse(route.request().postDataJSON());
        if (input.action !== "revision-draft") throw new Error("예상하지 않은 수정 저장 요청");
        fixture.replace(saveEditorRevisionDraft(fixture.read(), input.draft, input.reason));
        started.resolve(); await release.promise; await route.abort("failed"); return;
      }
    }
    await route.fallback();
  });
  const text = page.getByRole("textbox", { name: "나의 수정본", exact: true });
  await text.fill("서버에 보낸 첫 수정본"); await started.promise;
  await text.fill("대기 중 더 고친 최신 수정본"); release.resolve();
  await expect(page.getByText("저장 결과가 아직 확인되지 않았어요", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "최신 개선 기록 확인", exact: true }).click();
  await expect(text).toHaveValue("대기 중 더 고친 최신 수정본");
  await expect.poll(() => fixture.read().draft.text).toBe("대기 중 더 고친 최신 수정본");
  expect(writes).toBe(2);
});
