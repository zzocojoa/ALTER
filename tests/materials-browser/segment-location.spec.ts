import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import { checkAccessibility } from "../fixtures/accessibility";
import type { MaterialCard } from "../../lib/materials/library";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000503";

test("표·수식의 위치와 미확인 표시는 원본 확대·회전 배치에서도 일치한다", async ({ page }, info): Promise<void> => {
  const png: Buffer = await readFile("tests/fixtures/pngsuite/basn2c08.png");
  const base: MaterialCard = materialFixture(502);
  const material: MaterialCard = { ...base, metadata: { ...base.metadata, kind: "image", mime: "image/png", filename: "원본.png", bytes: png.length }, file: { ...base.file, kind: "image", bytes: png.length } };
  const saved: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 1, version: 2, resultVersion: 1, resultId: id, state: "complete", printedPage: "iii", pendingAiKey: null, pendingImage: null, failure: null, confirmedSegmentIds: [], resultImage: { width: 32, height: 32, sourceWidth: 32, sourceHeight: 32, sourceToImage: [1, 0, 0, 1, 0, 0], rotation: 0, coordinateSpace: "decoded-image", mime: "image/png", bytes: png.length, sha256: material.file.sha256 }, result: { filePage: 1, method: "vision", status: "complete", width: 32, height: 32, rotation: 0, error: null, requiresConfirmation: true, segments: [
    { id: "s0", kind: "formula", text: "1/4", bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, transform: null, uncertain: true, reason: "분모 확인 필요" },
    { id: "s1", kind: "table", text: "열 1 | 열 2\n값 1 | 값 2", bounds: { x: 0.5, y: 0.4, width: 0.4, height: 0.3 }, transform: null, uncertain: false, reason: null }
  ] } };
  const methods: string[] = [];
  await materialBrowser(page, { ...emptyMaterialLibrary, materials: [material] }, async (route): Promise<void> => {
    const request = route.request(); const path: string = new URL(request.url()).pathname;
    methods.push(request.method()); expect(["GET", "HEAD"]).toContain(request.method());
    if (path.endsWith("/extraction")) { await route.fulfill({ json: { job: { jobId: id, revision: 1, uploadId: id, selection: { materialId: material.id, originalVersion: material.file.objectVersion, originalHash: material.file.sha256, pages: [{ filePage: 1, purpose: "study" }] } }, pages: [saved] } }); return; }
    expect(path).toBe(material.file.sourceUrl); await route.fulfill({ contentType: "image/png", body: request.method() === "HEAD" ? undefined : png });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".alter-material-row").click();
  const comparison = page.getByRole("region", { name: "원본과 결과 비교", exact: true });
  const resultTab = comparison.getByRole("tab", { name: "추출 결과 보기", exact: true });
  await comparison.getByText("추출 내용 수정", { exact: true }).click();
  await comparison.getByRole("textbox", { name: "구간 1 수정", exact: true }).fill("미저장 수식 1/4");
  await comparison.getByRole("button", { name: "구간 1 원본 위치", exact: true }).click();
  const source = comparison.getByRole("region", { name: "파일 1페이지 구간 대조", exact: true });
  await expect(source).toBeFocused();
  await expect(source).toContainText("미확인 구간");
  const highlight = source.locator(".alter-original-highlight");
  await expect(highlight).toHaveAttribute("data-uncertain", "true");
  const image = source.getByRole("img"); await expect(image).toBeVisible();
  const initial = await image.boundingBox(); const marked = await highlight.boundingBox();
  if (initial === null || marked === null) throw new Error("원본과 구간 위치를 읽을 수 없습니다.");
  expect(marked.x - initial.x).toBeCloseTo(initial.width * 0.1, 0);
  expect(marked.y - initial.y).toBeCloseTo(initial.height * 0.2, 0);
  expect(marked.width).toBeCloseTo(initial.width * 0.3, 0);
  const zoom = source.getByRole("slider", { name: "사진 확대", exact: true });
  await zoom.focus(); await page.keyboard.press("ArrowRight"); await expect(zoom).toHaveValue("125");
  const enlarged = await image.boundingBox(); const enlargedMark = await highlight.boundingBox();
  if (enlarged === null || enlargedMark === null) throw new Error("확대 위치를 읽을 수 없습니다.");
  expect(enlargedMark.width).toBeCloseTo(enlarged.width * 0.3, 0);
  await source.getByRole("button", { name: "파일 1페이지 원본 크게 보기", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog.locator(".alter-original-highlight")).toBeVisible();
  await page.keyboard.press("Escape"); await resultTab.click();
  await expect(comparison.getByRole("textbox", { name: "구간 1 수정", exact: true })).toHaveValue("미저장 수식 1/4");
  await comparison.getByRole("button", { name: "구간 2 원본 위치", exact: true }).click();
  await expect(highlight).toHaveAttribute("data-uncertain", "false");
  await expect(source).toContainText("위치 표시는 내용 확정을 뜻하지 않아요");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(comparison.getByRole("textbox", { name: "구간 1 수정", exact: true })).toHaveValue("미저장 수식 1/4");
  await expect(comparison.getByRole("checkbox", { name: "구간 2 확인", exact: true })).not.toBeChecked();
  await checkAccessibility(page, ".extraction-review", info);
  await page.screenshot({ path: `outputs/ui-extraction/segment-location-${info.project.name}.png`, fullPage: true });
  expect(methods.every((method): boolean => ["GET", "HEAD"].includes(method))).toBe(true);
  expect(await page.pageErrors()).toEqual([]);
});
