import { expect, test } from "@playwright/test";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import { initialTranscription, transcriptionInput } from "../../lib/extraction/transcription";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000811";
const resultId: string = "00000000-0000-4000-a000-000000000812";
for (const outcome of ["committed", "unchanged", "wrong-page"] as const) {
  test(`첫 전사 응답 유실 ${outcome}는 재전송 없이 GET으로만 대조한다`, async ({ page }): Promise<void> => {
    const card = materialFixture(810);
    let saved: StoredExtractionPage = { id, jobId: card.id, selectionRevision: 1, filePage: 1, version: 1, resultVersion: 0, resultId: null, state: "pending", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: null };
    let posts: number = 0; let failRead: boolean = false;
    await materialBrowser(page, { ...emptyMaterialLibrary, materials: [card] }, async (route): Promise<void> => {
      const request = route.request(); const path: string = new URL(request.url()).pathname;
      if (path.endsWith("/edit")) {
        expect(request.method()).toBe("POST"); posts++;
        const input = transcriptionInput.parse(request.postDataJSON());
        expect(input).toMatchObject({ intent: "transcribe", resultId: null, expectedVersion: 1, segments: [{ id: "s0", text: "보관할 첫 전사" }] });
        if (outcome !== "unchanged") saved = { ...saved, version: 2, resultVersion: 1, resultId, state: "complete", jobId: outcome === "wrong-page" ? id : card.id, result: initialTranscription(input) };
        await route.abort("failed"); return;
      }
      expect(["GET", "HEAD"]).toContain(request.method());
      if (path.endsWith("/extraction")) {
        if (failRead) { await route.fulfill({ status: 503, json: { error: "snapshot-unavailable" } }); return; }
        await route.fulfill({ json: { job: { jobId: card.id, revision: 1, uploadId: id, selection: { materialId: card.id, originalVersion: card.file.objectVersion, originalHash: card.file.sha256, pages: [{ filePage: 1, purpose: "study" }] } }, pages: [saved] } }); return;
      }
      expect(path).toBe(card.file.sourceUrl); await route.fulfill({ contentType: "text/plain", body: "대조할 원본" });
    });
    await page.locator(".alter-material-row").click();
    const comparison = page.getByRole("region", { name: "원본과 결과 비교", exact: true });
    const draft = comparison.getByRole("textbox", { name: "구간 1 수정", exact: true });
    await draft.fill("보관할 첫 전사"); expect(posts).toBe(0);
    await comparison.getByRole("form", { name: "직접 전사 저장", exact: true }).evaluate((form: HTMLFormElement): void => { form.requestSubmit(); form.requestSubmit(); });
    await expect(comparison.getByRole("alert").filter({ hasText: "저장 실패·결과 미확정" })).toBeVisible();
    await expect(draft).toHaveValue("보관할 첫 전사");
    await expect(comparison.getByRole("button", { name: "전사본 저장", exact: true })).toBeDisabled(); expect(posts).toBe(1);
    const read = comparison.getByRole("button", { name: "저장 결과 다시 읽기", exact: true });
    failRead = true; await read.click(); await expect(comparison.getByText(/snapshot-unavailable/)).toBeVisible();
    await expect(draft).toHaveValue("보관할 첫 전사"); expect(posts).toBe(1);
    failRead = false; await read.click();
    if (outcome === "committed") {
      await expect(comparison.getByText(/내용이 현재 저장값과 일치해요/)).toBeVisible();
      await expect(comparison.getByLabel("구간 1 추출 내용", { exact: true })).toHaveText("보관할 첫 전사");
      await expect(comparison.getByRole("checkbox", { name: "구간 1 확인", exact: true })).toBeEnabled();
      await page.reload();
      await expect(comparison.getByLabel("구간 1 추출 내용", { exact: true })).toHaveText("보관할 첫 전사");
    } else if (outcome === "unchanged") {
      await expect(comparison.getByRole("alert").filter({ hasText: "저장 내용과 일치하지 않아요" })).toBeVisible();
      await comparison.getByRole("button", { name: "재조회한 결과와 대조하고 편집 이어가기", exact: true }).click();
      await expect(comparison.getByRole("button", { name: "전사본 저장", exact: true })).toBeEnabled();
      await expect(draft).toHaveValue("보관할 첫 전사");
    } else {
      await expect(comparison.getByText(/저장 응답의 파일 페이지/)).toBeVisible();
      await expect(comparison.getByRole("button", { name: "전사본 저장", exact: true })).toBeDisabled();
    }
    expect(posts).toBe(1); expect(await page.pageErrors()).toEqual([]);
  });
}
