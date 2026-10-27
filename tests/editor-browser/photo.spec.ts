import { expect, test } from "@playwright/test";
import { editorWaitingFixture } from "../fixtures/editor-state";
import { mountEditorInput } from "../fixtures/editor-input-browser";
import { tutorId } from "../fixtures/tutor-state";
import { pngImage } from "../fixtures/png-bytes";

test("사진 등록 뒤 답안 저장 응답이 유실돼도 같은 저장 키로 확인하고 이력을 유지", async ({ page }): Promise<void> => {
  const fixture = await mountEditorInput(page, editorWaitingFixture());
  const text: string = "3/8입니다. 여덟 조각 중 세 조각입니다.";
  const reason: string = "전체 조각 수와 선택한 조각 수를 구분했습니다.";
  await page.getByRole("textbox", { name: "나의 수정본", exact: true }).fill(text);
  await page.getByRole("textbox", { name: "수정 이유", exact: true }).fill(reason);
  await expect(page.locator("#editor-draft-status")).toContainText("서버 초안 저장을 확인했어요");
  const uploadId: string = tutorId(101); const materialId: string = tutorId(102);
  let uploaded: number = 0; let registrations: number = 0; let readOnlyPhoto: boolean = false;
  await page.route("**/api/materials/uploads**", async (route): Promise<void> => {
    const path: string = new URL(route.request().url()).pathname;
    if (path === "/api/materials/uploads") { registrations += 1; await route.fulfill({ json: { id: uploadId, materialId, version: 1, state: "reserved" } }); return; }
    if (path.endsWith("/body")) { uploaded += 1; await route.fulfill({ json: { id: uploadId, materialId, version: 2, state: "stored" } }); return; }
    if (path.endsWith("/complete")) { readOnlyPhoto = true; await route.fulfill({ json: { id: uploadId, materialId, version: 3, state: "registered" } }); return; }
    expect(path).toBe(`/api/materials/uploads/${uploadId}`); await route.fulfill({ json: { id: uploadId, materialId, version: 1, state: "reserved" } });
  });
  const storageKeys: string[] = []; let failOnce: boolean = true;
  await page.route("**/api/editor", async (route): Promise<void> => {
    if (route.request().method() === "POST" && readOnlyPhoto) {
      storageKeys.push(route.request().headers()["idempotency-key"]);
      if (failOnce) { failOnce = false; await route.abort("failed"); return; }
    }
    await route.fallback();
  });
  const photo = { name: "editor-answer.png", mimeType: "image/png", buffer: Buffer.from(pngImage({ width: 1, height: 1, depth: 8, color: 2, interlace: 0 }, new Uint8Array([0, 20, 40, 60]))) };
  await page.locator("#editor-photo").setInputFiles(photo);
  await expect(page.getByRole("status", { name: "사진 전송 상태", exact: true })).toContainText("사진은 등록됐지만 답안 저장이 확인되지 않았어요");
  await expect(page.locator("#editor-photo")).toBeDisabled(); expect(fixture.read().draft.fileIds).toEqual([]);
  await expect(page.getByRole("textbox", { name: "나의 수정본", exact: true })).toHaveValue(text);
  await page.getByRole("button", { name: "같은 저장 요청 다시 확인", exact: true }).click();
  await expect(page.getByRole("status", { name: "사진 전송 상태", exact: true })).toHaveText("사진 첨부와 초안 저장이 완료됐어요.");
  expect(storageKeys).toHaveLength(2); expect(storageKeys[0]).toBe(storageKeys[1]); expect(uploaded).toBe(1); expect(registrations).toBe(1);
  expect(fixture.read().draft.fileIds).toEqual([materialId]);
  expect(await page.evaluate((id): string | null => sessionStorage.getItem(`alter.tutor.photo.${id}`), fixture.read().id)).toBeNull();
  await page.reload(); await expect(page.getByRole("textbox", { name: "나의 수정본", exact: true })).toHaveValue(text);
  await expect(page.getByRole("textbox", { name: "수정 이유", exact: true })).toHaveValue(reason); await expect(page.getByText("첨부: 사진 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "수정본과 이유 제출·저장", exact: true }).click();
  await expect(page.getByText("수정본과 이유를 저장했어요. 원본과 피드백은 그대로 보관해요.", { exact: true })).toBeVisible();
  await page.getByText("초안·수정 이유 이력 (2)", { exact: true }).click();
  await expect(page.getByRole("article", { name: "수정본 1판", exact: true })).toContainText(text);
  await expect(page.getByRole("article", { name: "수정본 1판", exact: true })).toContainText(reason);
  expect(fixture.read().editor?.versions.at(-1)?.fileIds).toEqual([materialId]);
  expect(fixture.requests.every((entry): boolean => ["revision-draft", "revision-submit"].includes(entry.input.action))).toBe(true);
  expect(await page.pageErrors()).toEqual([]);
});
