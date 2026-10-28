import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { z } from "zod";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import { extractionPdf } from "../fixtures/extraction-pdf";
import { fixtureVisionBudget } from "../fixtures/vision-budget";
import { pageResult } from "../../lib/extraction/result";
import { preparedPageImage } from "../../lib/extraction/image";
import { metadataOfImage } from "../../lib/extraction/state";
import { correctedPage, correctionInput, confirmationInput, requireConfirmableSegments } from "../../lib/extraction/confirmation";
import type { MaterialCard } from "../../lib/materials/library";
import type { StoredExtractionPage } from "../../lib/extraction/state";

async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  for (let step: number = 0; step < 150; step += 1) {
    if (await target.evaluate((element: Element): boolean => document.activeElement === element)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Tab 순환 안에서 대상에 도달하지 못했어요.");
}
async function activate(page: Page, target: Locator): Promise<void> { await tabTo(page, target); await page.keyboard.press("Enter"); }
async function checkWithKeyboard(page: Page, target: Locator): Promise<void> { await tabTo(page, target); await page.keyboard.press("Space"); }

test("PDF 준비·모의 판독·원본 대조·전사·확인 저장의 전체 키보드 여정", async ({ page }): Promise<void> => {
  const pdf: Buffer = Buffer.from(extractionPdf()); const sha256: string = createHash("sha256").update(pdf).digest("hex");
  const base = materialFixture(850);
  const card: MaterialCard = { ...base, metadata: { ...base.metadata, kind: "pdf", mime: "application/pdf", filename: "keyboard.pdf", bytes: pdf.length, sha256 }, file: { ...base.file, kind: "pdf", pages: 7, bytes: pdf.length, sha256 } };
  const pageId: string = "00000000-0000-4000-a000-000000000851";
  let saved: StoredExtractionPage = { id: pageId, jobId: card.id, selectionRevision: 1, filePage: 2, version: 1, resultId: null, resultVersion: 0, state: "pending", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: null };
  let textPage: StoredExtractionPage = { ...saved, id: "00000000-0000-4000-a000-000000000854", filePage: 1 };
  let textPosts: number = 0;
  let visionPosts: number = 0; let editPosts: number = 0; let confirmPosts: number = 0;
  await materialBrowser(page, { ...emptyMaterialLibrary, materials: [card] }, async (route): Promise<void> => {
    const request = route.request(); const path: string = new URL(request.url()).pathname;
    if (path.endsWith("/extraction")) {
      expect(request.method()).toBe("GET");
      await route.fulfill({ json: { job: { jobId: card.id, revision: 1, uploadId: pageId, selection: { materialId: card.id, originalVersion: card.file.objectVersion, originalHash: sha256, pages: [{ filePage: 1, purpose: "study" }, { filePage: 2, purpose: "study" }] } }, pages: [textPage, saved] } }); return;
    }
    if (path.endsWith("/text")) {
      textPosts++;
      const input = z.object({ filePage: z.literal(1), selectionRevision: z.literal(1), expectedVersion: z.literal(1), result: pageResult }).parse(request.postDataJSON());
      textPage = { ...textPage, state: "complete", version: 2, resultVersion: 1, resultId: "00000000-0000-4000-a000-000000000855", result: input.result };
      await route.fulfill({ json: { page: textPage } }); return;
    }
    if (path === "/api/dashboard/usage") { expect(request.method()).toBe("GET"); await route.fulfill({ json: fixtureVisionBudget(Date.now()) }); return; }
    if (path.endsWith("/vision")) {
      visionPosts++;
      const input = z.object({ filePage: z.literal(2), selectionRevision: z.literal(1), expectedVersion: z.literal(1), comparedWithOriginal: z.literal(true), image: preparedPageImage }).parse(request.postDataJSON());
      saved = { ...saved, state: "complete", version: 2, resultVersion: 1, resultId: "00000000-0000-4000-a000-000000000852", resultImage: metadataOfImage(input.image), result: { filePage: 2, method: "vision", status: "complete", width: input.image.width, height: input.image.height, rotation: 0, segments: [{ id: "s0", kind: "text", text: "모의 판독 결과", bounds: null, transform: null, uncertain: true, reason: "합성 판독 결과 · 원본 대조 필요" }], error: null, requiresConfirmation: true } };
      await route.fulfill({ json: { page: saved } }); return;
    }
    if (path.endsWith("/edit")) {
      editPosts++; const input = correctionInput.parse(request.postDataJSON());
      saved = { ...saved, version: 3, resultVersion: 2, resultId: "00000000-0000-4000-a000-000000000853", result: correctedPage(saved, input), confirmedSegmentIds: [] };
      await route.fulfill({ json: { page: saved } }); return;
    }
    if (path.endsWith("/confirm")) {
      confirmPosts++; const input = confirmationInput.parse(request.postDataJSON());
      requireConfirmableSegments(saved, input); saved = { ...saved, version: 4, confirmedSegmentIds: input.segmentIds };
      await route.fulfill({ json: { page: saved } }); return;
    }
    expect(path).toBe(card.file.sourceUrl); expect(["GET", "HEAD"]).toContain(request.method());
    await route.fulfill({ headers: { "content-type": "application/pdf", etag: '"fixture"', "content-length": String(pdf.length) }, body: request.method() === "HEAD" ? undefined : pdf });
  });
  await activate(page, page.locator(".alter-material-row"));
  await activate(page, page.getByRole("button", { name: "파일 1페이지 텍스트 추출", exact: true }));
  await activate(page, page.getByRole("button", { name: "파일 1페이지 저장된 결과 확인", exact: true }));
  await expect(page.getByRole("heading", { name: "파일 1페이지 · 결과 1판", exact: true })).toBeFocused();
  await expect(page.getByLabel("구간 1 추출 내용", { exact: true })).toContainText("Synthetic text");
  await activate(page, page.getByRole("button", { name: "파일 2페이지 이미지 준비", exact: true }));
  const vision = page.getByRole("form", { name: "파일 2페이지 AI 판독", exact: true });
  await expect(vision).toBeVisible(); expect(visionPosts).toBe(0);
  await activate(page, vision.getByRole("button", { name: "저장된 비용·승인 조건 확인", exact: true }));
  await expect(vision.getByRole("button", { name: "이 페이지 AI 판독", exact: true })).toBeEnabled();
  await checkWithKeyboard(page, vision.getByRole("checkbox")); expect(visionPosts).toBe(0);
  await activate(page, vision.getByRole("button", { name: "이 페이지 AI 판독", exact: true }));
  await activate(page, page.getByRole("button", { name: "파일 2페이지 저장된 결과 확인", exact: true }));
  const comparison = page.getByRole("region", { name: "원본과 결과 비교", exact: true });
  await expect(comparison.getByRole("heading", { name: "파일 2페이지 · 결과 1판", exact: true })).toBeFocused();
  await activate(page, comparison.getByRole("button", { name: "구간 1 원본 페이지", exact: true }));
  await expect(comparison.getByRole("region", { name: "파일 2페이지 구간 대조", exact: true })).toBeFocused();
  const expand = comparison.getByRole("button", { name: "파일 2페이지 원본 크게 보기", exact: true });
  await activate(page, expand);
  const dialog = page.getByRole("dialog", { name: "파일 2페이지 원본", exact: true });
  await expect(dialog).toBeVisible();
  const controls: number = await dialog.locator('button:visible, input:visible, select:visible, [tabindex="0"]:visible').count();
  for (const key of ["Tab", "Shift+Tab"]) for (let step: number = 0; step < controls + 2; step += 1) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((element: Element): boolean => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape"); await expect(expand).toBeFocused();
  await activate(page, comparison.getByRole("button", { name: "페이지별 다음 행동으로 돌아가기", exact: true }));
  await activate(page, page.getByRole("button", { name: "파일 2페이지 직접 전사", exact: true }));
  const draft = comparison.getByRole("textbox", { name: "구간 1 수정", exact: true });
  await expect(draft).toBeFocused(); await expect(draft).toHaveValue("모의 판독 결과");
  await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText("키보드로 대조한 전사");
  await expect(comparison.getByRole("button", { name: "선택 구간 확인 저장", exact: true })).toBeDisabled();
  await activate(page, comparison.getByRole("button", { name: "수정본 저장", exact: true }));
  await expect(comparison.getByLabel("구간 1 추출 내용", { exact: true })).toHaveText("키보드로 대조한 전사");
  await checkWithKeyboard(page, comparison.getByRole("checkbox", { name: "구간 1 확인", exact: true }));
  await checkWithKeyboard(page, comparison.getByRole("checkbox", { name: "선택한 구간을 이 파일 페이지의 원본과 대조했어요.", exact: true }));
  await activate(page, comparison.getByRole("button", { name: "선택 구간 확인 저장", exact: true }));
  await expect(comparison.getByText("텍스트 · 확인됨", { exact: true })).toBeVisible();
  await page.reload();
  await activate(page, comparison.getByRole("button", { name: "파일 2페이지 결과", exact: true }));
  await expect(comparison.getByText("텍스트 · 확인됨", { exact: true })).toBeVisible();
  expect([textPosts, visionPosts, editPosts, confirmPosts]).toEqual([1, 1, 1, 1]); expect(await page.pageErrors()).toEqual([]);
});
