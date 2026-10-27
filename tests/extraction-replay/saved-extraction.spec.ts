import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { savedExtractionEntries, loadSavedExtraction } from "../fixtures/saved-extraction";
import type { SavedExtractionFixture } from "../fixtures/saved-extraction";
import { checkAccessibility } from "../fixtures/accessibility";

async function replyOriginal(route: Route, fixture: SavedExtractionFixture): Promise<void> {
  const request = route.request(); const total: number = fixture.pdf.length; const etag: string = `"${fixture.material.file.objectVersion}"`;
  const headers = { "content-type": "application/pdf", "accept-ranges": "bytes", etag, "cache-control": "private, no-store" };
  const match: string | undefined = request.headers()["if-match"];
  if (match !== undefined && match !== etag) throw new Error("원본 버전 조건이 저장된 파일과 다릅니다.");
  if (request.method() === "HEAD") { await route.fulfill({ headers: { ...headers, "content-length": String(total) } }); return; }
  const range: string | undefined = request.headers().range;
  if (range === undefined) { await route.fulfill({ headers: { ...headers, "content-length": String(total) }, body: fixture.pdf }); return; }
  const parsed: RegExpExecArray | null = /^bytes=(\d+)-(\d+)$/.exec(range);
  if (parsed === null) throw new Error(`지원하지 않는 원본 범위 요청: ${range}`);
  const start: number = Number(parsed[1]); const end: number = Math.min(Number(parsed[2]), total - 1);
  if (start > end || start < 0) throw new Error(`원본 범위를 벗어난 요청: ${range}`);
  await route.fulfill({ status: 206, headers: { ...headers, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${total}` }, body: fixture.pdf.subarray(start, end + 1) });
}

async function replayReads(page: Page, fixture: SavedExtractionFixture, requests: string[]): Promise<void> {
  await page.route("**/*", async (route): Promise<void> => {
    const request = route.request(); const url: URL = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:5173") throw new Error(`로컬 비교 중 외부 요청을 차단했습니다: ${url.origin}`);
    if (!["GET", "HEAD"].includes(request.method())) throw new Error(`읽기 전용 비교 중 쓰기를 차단했습니다: ${request.method()} ${url.pathname}`);
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    requests.push(`${request.method()} ${url.pathname}`);
    if (url.pathname === "/api/materials") { await route.fulfill({ json: fixture.library }); return; }
    if (url.pathname === `/api/materials/${fixture.material.id}/extraction`) { await route.fulfill({ json: fixture.snapshot }); return; }
    if (url.pathname === fixture.material.file.sourceUrl) { await replyOriginal(route, fixture); return; }
    throw new Error(`허용하지 않은 API를 차단했습니다: ${url.pathname}`);
  });
}

for (const entry of savedExtractionEntries(process.env.ALTER_EXTRACTION_REPLAY_MANIFEST)) {
  test(`${entry.label}: 저장된 판독·확인 상태와 원본 위치를 그대로 비교한다`, async ({ page }, info): Promise<void> => {
    const fixture: SavedExtractionFixture = loadSavedExtraction(entry); const requests: string[] = [];
    const viewport = page.viewportSize(); if (viewport === null) throw new Error("검증 화면 크기가 필요합니다.");
    await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
    await replayReads(page, fixture, requests);
    await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click();
    await page.locator(`#material-${fixture.material.id}`).click();
    const comparison = page.getByRole("region", { name: "원본과 결과 비교", exact: true });
    await expect(comparison.getByRole("complementary", { name: "등록 정보와 서지 확인" })).toContainText("등록 정보는 추출한 본문이 아니에요");
    for (const saved of fixture.snapshot.pages) {
      if (saved.result === null) throw new Error("비교할 저장 결과가 없습니다.");
      await comparison.getByRole("button", { name: `파일 ${saved.filePage}페이지 결과`, exact: true }).click();
      if (viewport.width < 1024) await comparison.getByRole("tab", { name: "추출 결과 보기", exact: true }).click();
      await expect(comparison.getByRole("heading", { name: `파일 ${saved.filePage}페이지 · 결과 ${saved.resultVersion}판`, exact: true })).toBeVisible();
      await expect(comparison.getByRole("textbox", { name: "인쇄된 쪽수", exact: true })).toHaveValue(saved.printedPage ?? "");
      for (const [index, segment] of saved.result.segments.entries()) {
        const region = comparison.getByRole("region", { name: `구간 ${index + 1}`, exact: true });
        const content = region.getByLabel(`구간 ${index + 1} 추출 내용`, { exact: true });
        expect(await content.textContent()).toBe(segment.text);
        await content.focus(); await expect(content).toBeFocused();
        if (await content.evaluate((element): boolean => element.scrollWidth > element.clientWidth)) {
          await page.keyboard.press("ArrowRight"); await expect.poll(() => content.evaluate((element): number => element.scrollLeft)).toBeGreaterThan(0);
        }
        const confirmed: boolean = saved.confirmedSegmentIds.includes(segment.id);
        await expect(region.locator("p").first()).toContainText(confirmed ? " · 확인됨" : " · 미확인");
        await expect(region.getByRole("checkbox")).toHaveCount(confirmed ? 0 : 1);
        if (!confirmed) await expect(region.getByRole("checkbox")).not.toBeChecked();
      }
      await comparison.getByRole("button", { name: "구간 1 원본 위치", exact: true }).click();
      const original = comparison.getByRole("region", { name: `파일 ${saved.filePage}페이지 구간 대조`, exact: true });
      await expect(original.getByText(`파일 ${saved.filePage}페이지 원본`, { exact: true }).last()).toBeVisible();
      const canvas = original.getByLabel(`대조 원본 ${saved.filePage}페이지`, { exact: true });
      await expect(canvas).toBeVisible(); expect(await canvas.evaluate((element): boolean => element instanceof HTMLCanvasElement && element.width > 0 && element.height > 0)).toBe(true);
      const highlight = original.locator(".alter-original-highlight"); await expect(highlight).toBeVisible();
      await expect(highlight).toHaveAttribute("data-uncertain", String(saved.result.segments[0].uncertain && !saved.confirmedSegmentIds.includes(saved.result.segments[0].id)));
      const sourceBounds = await canvas.boundingBox(); const segmentBounds = await highlight.boundingBox();
      if (sourceBounds === null || segmentBounds === null) throw new Error("원본과 구간 위치를 읽을 수 없습니다.");
      expect(segmentBounds.x).toBeGreaterThanOrEqual(sourceBounds.x - 1); expect(segmentBounds.y).toBeGreaterThanOrEqual(sourceBounds.y - 1);
      expect(segmentBounds.x + segmentBounds.width).toBeLessThanOrEqual(sourceBounds.x + sourceBounds.width + 1); expect(segmentBounds.y + segmentBounds.height).toBeLessThanOrEqual(sourceBounds.y + sourceBounds.height + 1);
      expect(segmentBounds.width).toBeGreaterThan(0); expect(segmentBounds.height).toBeGreaterThan(0);
      if (entry.label === "grade") { expect(Number.parseFloat(await highlight.evaluate((element): string => (element as HTMLElement).style.left))).toBeGreaterThanOrEqual(14); }
      await original.getByRole("slider", { name: "대조 원본 확대", exact: true }).focus(); await page.keyboard.press("ArrowRight");
      await expect(original.getByRole("slider")).toHaveValue("125");
      await comparison.screenshot({ path: `outputs/ui-extraction/replay-${entry.label}-p${saved.filePage}-${info.project.name}.png` });
      if (viewport.width < 1024) await comparison.getByRole("tab", { name: "추출 결과 보기", exact: true }).click();
      await checkAccessibility(page, ".extraction-review", info);
      expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.getByRole("button", { name: "저장 상태 다시 확인", exact: true }).click();
    expect(requests.every((request): boolean => request.startsWith("GET ") || request.startsWith("HEAD "))).toBe(true);
    expect(await page.pageErrors()).toEqual([]);
    expect(loadSavedExtraction(entry).snapshot).toEqual(fixture.snapshot);
    await info.attach("저장-원본-대조", { contentType: "application/json", body: JSON.stringify({ label: entry.label, originalHash: fixture.material.file.sha256, snapshotHash: entry.snapshotHash, pages: fixture.snapshot.pages.map((saved) => ({ filePage: saved.filePage, version: saved.version, resultVersion: saved.resultVersion, confirmed: saved.confirmedSegmentIds.length })), requests, paidCalls: 0, writes: 0 }) });
  });
}
