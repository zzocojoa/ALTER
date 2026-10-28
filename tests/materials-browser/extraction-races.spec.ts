import { expect, test } from "@playwright/test";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import { correctedPage, correctionInput } from "../../lib/extraction/confirmation";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000841";
const nextId: string = "00000000-0000-4000-a000-000000000842";
for (const race of ["older-read", "new-selection"] as const) {
  test(`늦은 응답 ${race}는 최신 결과와 선택을 되돌리지 않는다`, async ({ page }): Promise<void> => {
    const card = materialFixture(840);
    let saved: StoredExtractionPage = { id, jobId: card.id, selectionRevision: 1, filePage: 1, version: 2, resultVersion: 1, resultId: id, state: "complete", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: { filePage: 1, method: "plain-text", status: "complete", width: null, height: null, rotation: 0, segments: [{ id: "s0", kind: "text", text: "이전 결과", bounds: null, transform: null, uncertain: false, reason: null }], error: null, requiresConfirmation: true } };
    const held: { read: (() => Promise<void>) | null; edit: (() => Promise<void>) | null } = { read: null, edit: null };
    let holdRead: boolean = false; let editPosts: number = 0;
    function snapshot() { return { job: { jobId: card.id, revision: saved.selectionRevision, uploadId: id, selection: { materialId: card.id, originalVersion: card.file.objectVersion, originalHash: card.file.sha256, pages: [{ filePage: 1, purpose: "study" }] } }, pages: [saved] }; }
    await materialBrowser(page, { ...emptyMaterialLibrary, materials: [card] }, async (route): Promise<void> => {
      const request = route.request(); const path: string = new URL(request.url()).pathname;
      if (path.endsWith("/extraction")) {
        if (request.method() === "POST") {
          expect(race).toBe("new-selection");
          saved = { ...saved, id: nextId, selectionRevision: 2, state: "pending", version: 1, resultVersion: 0, resultId: null, result: null };
          await route.fulfill({ json: snapshot() }); return;
        }
        const value = snapshot();
        if (holdRead) { held.read = async (): Promise<void> => route.fulfill({ json: value }); return; }
        await route.fulfill({ json: value }); return;
      }
      if (path.endsWith("/edit")) {
        editPosts++;
        const input = correctionInput.parse(request.postDataJSON());
        const edited: StoredExtractionPage = { ...saved, version: 3, resultVersion: 2, resultId: nextId, result: correctedPage(saved, input) };
        if (race === "new-selection") { held.edit = async (): Promise<void> => route.fulfill({ json: { page: edited } }); return; }
        saved = edited; await route.fulfill({ json: { page: saved } }); return;
      }
      expect(path).toBe(card.file.sourceUrl); expect(["GET", "HEAD"]).toContain(request.method()); await route.fulfill({ contentType: "text/plain", body: "대조 원본" });
    });
    await page.locator(".alter-material-row").click();
    const comparison = page.getByRole("region", { name: "원본과 결과 비교", exact: true });
    await comparison.getByText("추출 내용 수정", { exact: true }).click();
    const draft = comparison.getByRole("textbox", { name: "구간 1 수정", exact: true });
    await draft.fill("최신 수정 결과");
    if (race === "older-read") {
      holdRead = true; await page.getByRole("button", { name: "저장 상태 다시 확인", exact: true }).click();
      await expect.poll((): boolean => held.read !== null).toBe(true);
      await comparison.getByRole("button", { name: "수정본 저장", exact: true }).click();
      await expect(comparison.getByLabel("구간 1 추출 내용", { exact: true })).toHaveText("최신 수정 결과");
      await draft.focus();
      if (held.read === null) throw new Error("지연 조회가 준비되지 않았어요.");
      await held.read();
      await expect(page.getByRole("button", { name: "저장 상태 다시 확인", exact: true })).toBeEnabled();
      await expect(comparison.getByRole("heading", { name: "파일 1페이지 · 결과 2판", exact: true })).toBeVisible();
      await expect(comparison.getByLabel("구간 1 추출 내용", { exact: true })).toHaveText("최신 수정 결과");
      await expect(draft).toBeFocused();
    } else {
      await comparison.getByRole("button", { name: "수정본 저장", exact: true }).click();
      await expect.poll((): boolean => held.edit !== null).toBe(true);
      await page.getByRole("textbox", { name: "학습할 파일 페이지", exact: true }).fill("1 ");
      await page.getByRole("button", { name: "선택 범위 확인", exact: true }).click();
      await expect(comparison.getByRole("heading", { name: "파일 1페이지 · 결과 0판", exact: true })).toBeVisible();
      if (held.edit === null) throw new Error("지연 수정이 준비되지 않았어요.");
      await held.edit();
      await expect(comparison.getByRole("heading", { name: "파일 1페이지 · 결과 0판", exact: true })).toBeVisible();
      await expect(comparison.getByLabel("구간 1 추출 내용", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "파일 1페이지 저장된 결과 확인", exact: true })).toHaveCount(0);
      await expect(draft).toHaveValue("");
    }
    expect(editPosts).toBe(1); expect(await page.pageErrors()).toEqual([]);
  });
}
