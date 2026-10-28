import { expect, test } from "@playwright/test";
import { z } from "zod";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000703";
const nextId: string = "00000000-0000-4000-a000-000000000704";
for (const outcome of ["committed", "unchanged", "wrong-page"] as const) {
  test(`수정 저장 응답 유실 ${outcome}는 입력을 보존하고 읽기로만 확인한다`, async ({ page }): Promise<void> => {
    const card = materialFixture(702);
    let saved: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 1, version: 2, resultVersion: 1, resultId: id, state: "complete", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: { filePage: 1, method: "plain-text", status: "complete", width: null, height: null, rotation: 0, segments: [{ id: "s0", kind: "text", text: "기존 원문", bounds: null, transform: null, uncertain: false, reason: null }], error: null, requiresConfirmation: true } };
    let posts: number = 0; let failRead: boolean = false;
    await materialBrowser(page, { ...emptyMaterialLibrary, materials: [card] }, async (route): Promise<void> => {
      const request = route.request(); const path: string = new URL(request.url()).pathname;
      if (path.endsWith("/edit")) {
        expect(request.method()).toBe("POST"); posts++;
        const body = z.object({ expectedVersion: z.literal(2), resultId: z.literal(id), segments: z.array(z.object({ id: z.string(), text: z.string() })) }).passthrough().parse(request.postDataJSON());
        expect(body.segments).toEqual([{ id: "s0", text: "응답 유실에도 보관할 수정문" }]);
        if (saved.result === null) throw new Error("합성 추출 결과가 없습니다.");
        if (outcome !== "unchanged") saved = { ...saved, version: 3, resultVersion: 2, resultId: nextId, jobId: outcome === "wrong-page" ? nextId : id, result: { ...saved.result, method: "manual-correction", segments: [{ ...saved.result.segments[0], text: body.segments[0].text }] } };
        await route.abort("failed"); return;
      }
      expect(["GET", "HEAD"]).toContain(request.method());
      if (path.endsWith("/extraction")) {
        if (failRead) { await route.fulfill({ status: 503, json: { error: "snapshot-unavailable" } }); return; }
        await route.fulfill({ json: { job: { jobId: id, revision: 1, uploadId: id, selection: { materialId: card.id, originalVersion: card.file.objectVersion, originalHash: card.file.sha256, pages: [{ filePage: 1, purpose: "study" }] } }, pages: [saved] } }); return;
      }
      expect(path).toBe(card.file.sourceUrl); await route.fulfill({ contentType: "text/plain", body: "원문" });
    });
    await page.locator(".alter-material-row").click();
    const comparison = page.getByRole("region", { name: "원본과 결과 비교", exact: true });
    await comparison.getByRole("textbox", { name: "인쇄된 쪽수", exact: true }).fill("iii");
    await comparison.getByText("추출 내용 수정", { exact: true }).click();
    const correction = comparison.getByRole("textbox", { name: "구간 1 수정", exact: true }); await correction.fill("응답 유실에도 보관할 수정문");
    const save = comparison.getByRole("button", { name: "수정본 저장", exact: true }); await save.click();
    await expect(comparison.getByRole("alert")).toContainText("저장 실패·결과 미확정"); await expect(correction).toHaveValue("응답 유실에도 보관할 수정문"); await expect(save).toBeDisabled(); expect(posts).toBe(1);
    const read = comparison.getByRole("button", { name: "저장 결과 다시 읽기", exact: true });
    failRead = true; await read.click(); await expect(comparison.getByText(/snapshot-unavailable/)).toBeVisible(); await expect(correction).toHaveValue("응답 유실에도 보관할 수정문"); expect(posts).toBe(1);
    failRead = false; await read.click();
    if (outcome === "committed") {
      await expect(comparison.getByText(/내용이 현재 저장값과 일치해요/)).toBeVisible();
      await expect(comparison.getByRole("complementary", { name: "정정 후 학습 재검토", exact: true })).toContainText("다시 검토");
      await expect(save).toBeEnabled(); await expect(read).toHaveCount(0);
      await expect(comparison.getByRole("button", { name: "확인 구간 출처 연결", exact: true })).toHaveCount(0);
    } else if (outcome === "unchanged") {
      await expect(comparison.getByRole("alert")).toContainText("저장 내용과 일치하지 않아요"); await expect(save).toBeDisabled();
      await comparison.getByRole("button", { name: "재조회한 결과와 대조하고 편집 이어가기", exact: true }).click(); await expect(save).toBeEnabled();
    } else { await expect(comparison.getByText(/저장 응답의 파일 페이지/)).toBeVisible(); await expect(save).toBeDisabled(); }
    await expect(correction).toHaveValue("응답 유실에도 보관할 수정문"); await expect(comparison.getByRole("textbox", { name: "인쇄된 쪽수", exact: true })).toHaveValue("iii");
    expect(posts).toBe(1); expect(await page.pageErrors()).toEqual([]);
  });
}
