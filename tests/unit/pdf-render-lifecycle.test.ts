import { describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { PdfDocumentHandle } from "../../app/learn/materials/pdf-document";
import { renderPdfOriginal } from "../../app/learn/materials/render-pdf-original";

type Deferred<T> = Readonly<{ promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void }>;
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise: Promise<T> = new Promise<T>((success, failure): void => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
function renderFixture(): Readonly<{ handle: PdfDocumentHandle; page: PDFPageProxy; canvas: HTMLCanvasElement; render: ReturnType<typeof vi.fn>; cleanup: ReturnType<typeof vi.fn>; text: ReturnType<typeof vi.fn> }> {
  const render = vi.fn().mockReturnValue({ promise: Promise.resolve(), cancel: vi.fn() } as unknown as RenderTask);
  const cleanup = vi.fn().mockReturnValue(true);
  const text = vi.fn().mockResolvedValue({ items: [{ str: "검증 페이지", hasEOL: true }] });
  const page: PDFPageProxy = { getViewport: ({ scale }: { scale: number }) => ({ width: 10000 * scale, height: 20000 * scale }), render, cleanup, getTextContent: text } as unknown as PDFPageProxy;
  const handle: PdfDocumentHandle = { document: { getPage: vi.fn().mockResolvedValue(page) } as unknown as PDFDocumentProxy, etag: '"fixture"', assertCurrent: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
  return { handle, page, canvas: { width: 0, height: 0 } as HTMLCanvasElement, render, cleanup, text };
}

describe("원본 렌더 취소와 페이지 자원 정리", (): void => {
  it("늦게 도착한 페이지는 취소 후 캔버스를 쓰지 않고 정리한다", async (): Promise<void> => {
    const fixture = renderFixture(); const stop: AbortController = new AbortController(); const pending = deferred<PDFPageProxy>();
    vi.mocked(fixture.handle.document.getPage).mockReturnValue(pending.promise);
    const result: Promise<string> = renderPdfOriginal(fixture.handle, 1, fixture.canvas, stop.signal);
    const assertion = expect(result).rejects.toThrow("취소 검증");
    await vi.waitFor((): void => { expect(fixture.handle.document.getPage).toHaveBeenCalledOnce(); });
    stop.abort(new Error("취소 검증")); pending.resolve(fixture.page); await assertion;
    expect(fixture.render).not.toHaveBeenCalled(); expect(fixture.cleanup).toHaveBeenCalledOnce(); expect(fixture.canvas.width).toBe(0);
  });
  it("진행 중 렌더를 취소하고 텍스트 요청을 시작하지 않는다", async (): Promise<void> => {
    const fixture = renderFixture(); const stop: AbortController = new AbortController(); const pending = deferred<void>();
    const cancel = vi.fn((): void => pending.reject(new Error("렌더 취소 검증")));
    fixture.render.mockReturnValue({ promise: pending.promise, cancel } as unknown as RenderTask);
    const result: Promise<string> = renderPdfOriginal(fixture.handle, 1, fixture.canvas, stop.signal);
    const assertion = expect(result).rejects.toThrow("렌더 취소 검증");
    await vi.waitFor((): void => { expect(fixture.render).toHaveBeenCalledOnce(); }); stop.abort(); await assertion;
    expect(cancel).toHaveBeenCalled(); expect(fixture.cleanup).toHaveBeenCalledOnce(); expect(fixture.text).not.toHaveBeenCalled();
  });
  it("텍스트 도착 전에 취소하면 오래된 결과를 반환하지 않는다", async (): Promise<void> => {
    const fixture = renderFixture(); const stop: AbortController = new AbortController(); const pending = deferred<{ items: readonly { str: string; hasEOL: boolean }[] }>();
    fixture.text.mockReturnValue(pending.promise);
    const result: Promise<string> = renderPdfOriginal(fixture.handle, 1, fixture.canvas, stop.signal);
    const assertion = expect(result).rejects.toThrow("텍스트 취소 검증");
    await vi.waitFor((): void => { expect(fixture.text).toHaveBeenCalledOnce(); }); stop.abort(new Error("텍스트 취소 검증")); pending.resolve({ items: [{ str: "이전 원본", hasEOL: false }] }); await assertion;
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  });
  it("큰 페이지도 캔버스 장축과 픽셀 상한 안에서 그리고 정리한다", async (): Promise<void> => {
    const fixture = renderFixture(); expect(await renderPdfOriginal(fixture.handle, 1, fixture.canvas, new AbortController().signal)).toBe("검증 페이지\n");
    expect(Math.max(fixture.canvas.width, fixture.canvas.height)).toBeLessThanOrEqual(1600);
    expect(fixture.canvas.width * fixture.canvas.height).toBeLessThanOrEqual(4000000); expect(fixture.cleanup).toHaveBeenCalledOnce();
  });
});
