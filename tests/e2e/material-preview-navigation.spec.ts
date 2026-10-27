import { checkAccessibility } from "../fixtures/accessibility";
import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { MaterialCard, MaterialLibrary } from "../../lib/materials/library";
import type { StoredExtractionPage } from "../../lib/extraction/state";
import { readablePdf } from "../fixtures/pdf-bytes";

/** 긴 자료 목록만 주입하고 PDF.js와 원본 페이지 렌더링은 실제로 실행합니다. */
function previewLibrary(pdf: Uint8Array): MaterialLibrary {
  const courseId: string = randomUUID();
  const sha256: string = createHash("sha256").update(pdf).digest("hex");
  const materials: readonly MaterialCard[] = Array.from({ length: 13 }, (_, index): MaterialCard => {
    const id: string = randomUUID();
    return { id, courseId, metadata: { title: `이동 검증 ${index + 1}`, edition: "", role: "textbook", kind: "pdf", filename: "preview.pdf", mime: "application/pdf", bytes: pdf.length, sha256 }, file: { materialId: id, kind: "pdf", role: "textbook", bytes: pdf.length, pages: 3, sha256, objectVersion: "preview-navigation", sourceUrl: `/api/materials/${id}/file` } };
  });
  return { materials, courses: [{ id: courseId, title: "미리보기 이동 검증" }], pending: [], usage: null, hidden: false, hasMore: false, cursor: null };
}

test("긴 목록에서 PDF 클릭·목록 복귀·재선택·다른 자료 선택이 바로 보인다", async ({ page }, info): Promise<void> => {
  const pdf: Uint8Array = readablePdf(3);
  const library: MaterialLibrary = previewLibrary(pdf);
  let blocked: boolean = false;
  await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
  await page.route("**/api/materials", async (route): Promise<void> => { await route.fulfill({ json: library }); });
  await page.route("**/api/materials/*/extraction", async (route): Promise<void> => { await route.fulfill({ json: { job: null, pages: [] } }); });
  await page.route("**/api/materials/*/file", async (route): Promise<void> => { if(blocked) { await route.fulfill({status:403,body:""});return;} await route.fulfill({ status: 200, headers: { "content-type": "application/pdf", "content-length": String(pdf.length), etag: '\"preview-navigation\"' }, body: route.request().method() === "HEAD" ? undefined : Buffer.from(pdf) }); });
  await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click();
  await expect(page.locator(".alter-material-list > li")).toHaveCount(13);
  const first = page.locator(`#material-${library.materials[0].id}`);
  await first.click();
  const preview = page.getByRole("region", { name: "선택한 자료", exact: true });
  await expect(preview.getByRole("heading", { name: "이동 검증 1", exact: true })).toBeInViewport();
  await expect(preview).toBeFocused();
  await expect(preview.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
  await expect(preview.locator("canvas")).toBeInViewport();
  await preview.getByRole("button", { name: "자료 목록으로", exact: true }).click();
  await expect(first).toBeFocused();
  await expect(first).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(preview).toBeFocused();
  await expect(preview.getByRole("heading", { name: "이동 검증 1", exact: true })).toBeInViewport();
  await preview.getByRole("button", { name: "자료 목록으로", exact: true }).click();
  await page.locator(`#material-${library.materials[1].id}`).click();
  await expect(preview.getByRole("heading", { name: "이동 검증 2", exact: true })).toBeInViewport();
  await expect(preview.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
  await expect(preview.getByText("인쇄 쪽수:", { exact: false }).first()).toContainText("미확인");
  await preview.getByLabel("파일 페이지", { exact: true }).fill("0");
  await expect(preview.getByRole("alert")).toContainText("1부터 3까지");
  await expect(preview.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
  await preview.getByLabel("파일 페이지", { exact: true }).fill("4");
  await expect(preview.getByRole("alert")).toContainText("1부터 3까지");
  await preview.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(preview.getByText("2페이지를 열었어요.", { exact: true })).toBeVisible();
  const sourceZoom = preview.getByRole("slider", { name: "원본 확대", exact: true });
  await sourceZoom.focus(); await page.keyboard.press("ArrowRight"); await expect(sourceZoom).toHaveValue("125");
  const expand = preview.getByRole("button", { name: "파일 2페이지 원본 크게 보기", exact: true });
  await expand.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "파일 2페이지 원본", exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText("파일 2페이지 원본", { exact: true }).last()).toBeVisible();
  await dialog.getByRole("slider", { name: "대조 원본 확대" }).focus(); await page.keyboard.press("ArrowRight"); await expect(dialog.getByRole("slider")).toHaveValue("150");
  await dialog.getByRole("region", { name: "대조 원본 이동 영역" }).focus(); await page.keyboard.press("ArrowDown");
  for(let index=0;index<12;index++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true); }
  await checkAccessibility(page,".alter-dialog:has(.alter-original-content)",info);
  const viewport = page.viewportSize();
  for (const dimensions of [{ width: 800, height: 360 }, { width: 320, height: 400 }, { width: 390, height: 300 }]) {
    await page.setViewportSize(dimensions);
    await page.evaluate((): void => { document.documentElement.style.fontSize = "200%"; });
    const closeButton = dialog.getByRole("button", { name: "자료로 돌아가기 · 확대 화면 닫기", exact: true });
    await closeButton.focus();
    await expect(closeButton).toBeInViewport();
    const box = await closeButton.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) throw new Error("확대 화면 닫기 위치를 확인할 수 없습니다.");
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(dimensions.width);
    expect(box.y + box.height).toBeLessThanOrEqual(dimensions.height);
    await expect(dialog.getByRole("slider")).toHaveValue("150");
    await page.evaluate((): void => { document.documentElement.style.fontSize = ""; });
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`outputs/original-dialog-${info.project.name}.png`});
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(expand).toBeFocused(); if(viewport) await page.setViewportSize(viewport);
  await expect(sourceZoom).toHaveValue("125");
  await expect(preview.getByLabel("파일 페이지", { exact: true })).toHaveValue("2");
  blocked=true; await expand.click(); await expect(preview.getByRole("alert")).toContainText("HTTP 403"); await expect(dialog).toHaveCount(0); blocked=false;
  await page.screenshot({ path: `outputs/preview-navigation-${info.project.name}.png` });
  expect(await page.pageErrors()).toEqual([]);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate((): void => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(preview).toHaveCount(0);
});

for (const fault of ["offline", "mime", "corrupt", "worker", 401, 403, 404, 416, 422] as const) {
  test(`원본 실패 ${fault}는 선택과 쪽수를 유지하고 다른 판독을 실행하지 않는다`, async ({ page }): Promise<void> => {
    const pdf: Uint8Array = readablePdf(3); const library: MaterialLibrary = previewLibrary(pdf); const calls: string[] = [];
    await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
    await page.route("**/api/materials", async (route): Promise<void> => { calls.push(route.request().method()); await route.fulfill({ json: library }); });
    await page.route("**/api/materials/*/extraction", async (route): Promise<void> => { calls.push(route.request().method()); await route.fulfill({ json: { job: null, pages: [] } }); });
    if (fault === "worker") await page.route("**/pdfjs-6.4.299/pdf.worker.min.mjs", async (route): Promise<void> => { await route.fulfill({ status: 404, body: "not found" }); });
    await page.route("**/api/materials/*/file", async (route): Promise<void> => {
      calls.push(route.request().method());
      if (fault === "offline") { await route.abort("internetdisconnected"); return; }
      if (typeof fault === "number") { await route.fulfill({ status: fault, json: { error: "internal-test-only:https://private.invalid/secret" } }); return; }
      const body: Buffer = fault === "corrupt" ? Buffer.from("%PDF-1.7\ncorrupt\n") : Buffer.from(pdf);
      await route.fulfill({ headers: { "content-type": fault === "mime" ? "text/html" : "application/pdf", etag: '"fixture"', "content-length": String(body.length) }, body: route.request().method() === "HEAD" ? undefined : body });
    });
    await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click();
    await page.locator(`#material-${library.materials[0].id}`).click();
    const preview = page.getByRole("region", { name: "선택한 자료", exact: true });
    const expected: string = fault === "offline" ? "네트워크" : fault === "mime" ? "형식 또는 버전" : fault === "corrupt" ? "손상" : fault === "worker" ? "PDF 작업 파일" : `HTTP ${fault}`;
    await expect(preview.getByRole("alert")).toContainText(expected);
    await expect(preview.getByRole("heading", { name: "이동 검증 1", exact: true })).toBeVisible();
    await expect(preview.getByLabel("파일 페이지", { exact: true })).toHaveValue("1");
    await expect(preview.getByRole("alert")).not.toContainText("private.invalid");
    await expect(preview.locator("canvas")).toHaveCount(0);
    await preview.getByRole("button", { name: "다음 페이지", exact: true }).click();
    await expect(preview.getByLabel("파일 페이지", { exact: true })).toHaveValue("2");
    await expect(preview.getByRole("alert")).toContainText(expected);
    await expect(preview.getByRole("alert")).toContainText("파일 2페이지");
    expect(calls.every((method): boolean => method === "GET" || method === "HEAD")).toBe(true);
  });
}


test("실제 PDF 캔버스의 구간 표시가 선택 페이지와 확대 크기를 따른다", async ({ page }): Promise<void> => {
  const pdf: Uint8Array = readablePdf(3); const library: MaterialLibrary = previewLibrary(pdf); const card = library.materials[0]; const id: string = randomUUID();
  const saved: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 3, version: 2, resultVersion: 1, resultId: id, state: "complete", printedPage: "iii", pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: { filePage: 3, method: "text-layer", status: "complete", width: 612, height: 792, rotation: 0, segments: [{ id: "s0", kind: "text", text: "PDF 구간 대조", bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, transform: null, uncertain: true, reason: "원본 확인 필요" }], error: null, requiresConfirmation: true } };
  const methods: string[] = [];
  await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
  await page.route("**/api/materials", async (route): Promise<void> => { methods.push(route.request().method()); await route.fulfill({ json: library }); });
  await page.route("**/api/materials/*/extraction", async (route): Promise<void> => { methods.push(route.request().method()); await route.fulfill({ json: { job: { jobId: id, revision: 1, uploadId: id, selection: { materialId: card.id, originalVersion: card.file.objectVersion, originalHash: card.file.sha256, pages: [{ filePage: 3, purpose: "study" }] } }, pages: [saved] } }); });
  await page.route("**/api/materials/*/file", async (route): Promise<void> => { methods.push(route.request().method()); await route.fulfill({ headers: { "content-type": "application/pdf", "content-length": String(pdf.length), etag: '\"preview-navigation\"' }, body: route.request().method() === "HEAD" ? undefined : Buffer.from(pdf) }); });
  await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click(); await page.locator(`#material-${card.id}`).click();
  const comparison = page.getByRole("region", { name: "원본과 결과 비교", exact: true });
  await comparison.getByRole("button", { name: "구간 1 원본 위치", exact: true }).click();
  const source = comparison.getByRole("region", { name: "파일 3페이지 구간 대조", exact: true });
  await expect(source).toBeFocused();
  const canvas = source.getByLabel("대조 원본 3페이지", { exact: true }); await expect(canvas).toBeVisible();
  const highlight = source.locator(".alter-original-highlight"); await expect(highlight).toBeVisible();
  const bounds = await canvas.boundingBox(); const marker = await highlight.boundingBox();
  if (bounds === null || marker === null) throw new Error("PDF 원본 좌표를 확인할 수 없습니다.");
  expect(marker.x - bounds.x).toBeCloseTo(bounds.width * 0.1, 0); expect(marker.y - bounds.y).toBeCloseTo(bounds.height * 0.2, 0);
  const zoom = source.getByRole("slider", { name: "대조 원본 확대", exact: true }); await zoom.focus(); await page.keyboard.press("ArrowRight"); await expect(zoom).toHaveValue("125");
  const enlarged = await canvas.boundingBox(); const largerMark = await highlight.boundingBox();
  if (enlarged === null || largerMark === null) throw new Error("PDF 확대 좌표를 확인할 수 없습니다.");
  expect(largerMark.width).toBeCloseTo(enlarged.width * 0.3, 0);
  expect(methods.every((method): boolean => ["GET", "HEAD"].includes(method))).toBe(true); expect(await page.pageErrors()).toEqual([]);
});


test("원본 확대는 세로·가로에서 스크롤 전에 원본과 조작을 함께 보여 준다", async ({ page }, info): Promise<void> => {
  const pdf: Uint8Array = readablePdf(3);
  const library: MaterialLibrary = previewLibrary(pdf);
  await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
  await page.route("**/api/materials", async (route): Promise<void> => { await route.fulfill({ json: library }); });
  await page.route("**/api/materials/*/extraction", async (route): Promise<void> => { await route.fulfill({ json: { job: null, pages: [] } }); });
  await page.route("**/api/materials/*/file", async (route): Promise<void> => {
    expect(["GET", "HEAD"]).toContain(route.request().method());
    await route.fulfill({ headers: { "content-type": "application/pdf", "content-length": String(pdf.length), etag: '"viewer-fit"' }, body: route.request().method() === "HEAD" ? undefined : Buffer.from(pdf) });
  });
  await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click();
  await page.locator(`#material-${library.materials[0].id}`).click();
  const preview = page.getByRole("region", { name: "선택한 자료", exact: true });
  await expect(preview.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  const trigger = preview.getByRole("button", { name: "파일 1페이지 원본 크게 보기", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "파일 1페이지 원본", exact: true });
  const region = dialog.getByRole("region", { name: "대조 원본 이동 영역", exact: true });
  await expect(region).toBeVisible();
  const close = dialog.getByRole("button", { name: "자료로 돌아가기 · 확대 화면 닫기", exact: true });
  const zoom = dialog.getByRole("slider", { name: "대조 원본 확대", exact: true });
  for (const size of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 1280, height: 589 }, { width: 320, height: 400 }]) {
    await page.setViewportSize(size);
    await expect(close).toBeInViewport({ ratio: 1 });
    await expect(zoom).toBeInViewport({ ratio: 1 });
    const bounds = await region.boundingBox();
    if (bounds === null) throw new Error("원본 표시 영역을 찾을 수 없습니다.");
    expect(bounds.height, "원본이 화면 높이의 절반 이상을 차지해야 합니다.").toBeGreaterThanOrEqual(size.height * 0.55);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
    expect(bounds.y, "원본이 제목 바로 아래에 보여야 합니다.").toBeLessThanOrEqual(100);
    expect(await dialog.evaluate((element): number => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `outputs/ui-acceptance/W/original-fit-${info.project.name}-${size.width}x${size.height}.png` });
  }
  await zoom.focus(); await page.keyboard.press("ArrowRight"); await expect(zoom).toHaveValue("125");
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(zoom).toHaveValue("125");
  await expect(region).toBeInViewport({ ratio: 1 });
  await checkAccessibility(page, ".alter-dialog", info);
  await close.click();
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await expect(preview.getByLabel("파일 페이지", { exact: true })).toHaveValue("1");
  expect(await page.pageErrors()).toEqual([]);
});
