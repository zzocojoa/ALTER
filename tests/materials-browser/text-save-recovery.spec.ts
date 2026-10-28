import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import { pageResult } from "../../lib/extraction/result";
import type { MaterialCard } from "../../lib/materials/library";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000821";
const resultId: string = "00000000-0000-4000-a000-000000000822";
for (const outcome of ["committed", "unchanged", "wrong-page"] as const) {
  test(`텍스트 저장 응답 유실 ${outcome}는 반복 추출 없이 GET으로 확인한다`, async ({ page }): Promise<void> => {
    const source: Buffer = Buffer.from("확인할 원본 텍스트"); const sha256: string = createHash("sha256").update(source).digest("hex");
    const base = materialFixture(820);
    const card: MaterialCard = { ...base, file: { ...base.file, bytes: source.length, sha256 }, metadata: { ...base.metadata, bytes: source.length, sha256 } };
    let saved: StoredExtractionPage = { id, jobId: card.id, selectionRevision: 1, filePage: 1, version: 1, resultVersion: 0, resultId: null, state: "pending", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: null };
    let posts: number = 0; let failRead: boolean = false;
    await materialBrowser(page, { ...emptyMaterialLibrary, materials: [card] }, async (route): Promise<void> => {
      const request = route.request(); const path: string = new URL(request.url()).pathname;
      if (path.endsWith("/text")) {
        posts++; expect(request.method()).toBe("POST"); expect(request.postDataJSON()).toMatchObject({ expectedVersion: 1, selectionRevision: 1, filePage: 1 });
        const result = pageResult.parse(request.postDataJSON().result);
        if (outcome !== "unchanged") saved = { ...saved, version: 2, resultVersion: 1, resultId, state: "complete", jobId: outcome === "wrong-page" ? id : card.id, result };
        await route.abort("failed"); return;
      }
      expect(["HEAD", "GET"]).toContain(request.method());
      if (path.endsWith("/extraction")) {
        if (failRead) { await route.fulfill({ status: 503, json: { error: "snapshot-unavailable" } }); return; }
        await route.fulfill({ json: { job: { jobId: card.id, revision: 1, uploadId: id, selection: { materialId: card.id, originalVersion: card.file.objectVersion, originalHash: sha256, pages: [{ filePage: 1, purpose: "study" }] } }, pages: [saved] } }); return;
      }
      expect(path).toBe(card.file.sourceUrl); await route.fulfill({ contentType: "text/plain", body: source });
    });
    await page.locator(".alter-material-row").click();
    const extract = page.getByRole("button", { name: "선택 텍스트 추출", exact: true });
    await extract.evaluate((button: HTMLButtonElement): void => { button.click(); button.click(); });
    await expect(page.getByRole("alert").filter({ hasText: "텍스트 저장 결과 미확정" })).toBeVisible();
    expect(posts).toBe(1); await expect(extract).toHaveCount(0);
    const manualSave = page.getByRole("button", { name: "전사본 저장", exact: true }); await expect(manualSave).toBeDisabled();
    const read = page.getByRole("button", { name: "파일 1페이지 텍스트 저장 결과 다시 읽기", exact: true });
    failRead = true; await read.click(); await expect(page.getByRole("alert").filter({ hasText: "텍스트 저장 재조회 실패" })).toContainText("snapshot-unavailable"); expect(posts).toBe(1);
    failRead = false; await read.click();
    if (outcome === "committed") {
      await expect(page.getByLabel("구간 1 추출 내용", { exact: true })).toHaveText(source.toString());
      await expect(read).toHaveCount(0); await expect(extract).toHaveCount(0);
      await expect(page.getByRole("checkbox", { name: "구간 1 확인", exact: true })).toBeEnabled();
    } else if (outcome === "unchanged") {
      await expect(page.getByRole("alert").filter({ hasText: "요청한 텍스트와 일치하지 않아요" })).toBeVisible();
      await expect(extract).toHaveCount(0);
      await page.getByRole("button", { name: "재조회한 결과를 대조하고 다음 행동 선택", exact: true }).click();
      await expect(extract).toBeEnabled();
    } else {
      await expect(page.getByRole("alert").filter({ hasText: "텍스트 저장 재조회 실패" })).toContainText("저장 응답의 파일 페이지");
      await expect(extract).toHaveCount(0);
    }
    expect(posts).toBe(1); expect(await page.pageErrors()).toEqual([]);
  });
}
