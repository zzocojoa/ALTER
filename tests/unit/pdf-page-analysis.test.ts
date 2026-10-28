import { describe, expect, it, vi } from "vitest";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist";
import { classifyPdfPage } from "../../lib/extraction/pdf-analysis";
import type { PdfPageEvidence } from "../../lib/extraction/pdf-analysis";
import { analyzePdfPage, analyzeSelectedPdfPages } from "../../app/learn/materials/analyze-pdf-page";
import type { PdfPageAnalysis } from "../../app/learn/materials/analyze-pdf-page";
import { extractPdfPage, extractSelectedText } from "../../app/learn/materials/extract-text";
import type { PdfDocumentHandle } from "../../app/learn/materials/pdf-document";
import type { SelectionBinding } from "../../lib/extraction/selection";
import { extractionPdf } from "../fixtures/extraction-pdf";

const binding: SelectionBinding = { jobId: "00000000-0000-4000-8000-000000000001", revision: 1, selection: { materialId: "00000000-0000-4000-8000-000000000002" as SelectionBinding["selection"]["materialId"], originalVersion: "v1", originalHash: "a".repeat(64), pages: [{ filePage: 1, purpose: "study" }, { filePage: 2, purpose: "study" }] } };
function emptyPage(): PDFPageProxy {
  return { getViewport: vi.fn().mockReturnValue({ width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100] }), getTextContent: vi.fn().mockResolvedValue({ items: [] }), getOperatorList: vi.fn().mockResolvedValue({ fnArray: [] }), getAnnotations: vi.fn().mockResolvedValue([]), cleanup: vi.fn(), rotate: 0 } as unknown as PDFPageProxy;
}
function fixtureHandle(page: PDFPageProxy): PdfDocumentHandle {
  return { document: { getPage: vi.fn().mockResolvedValue(page) }, imageOperators: OPS, etag: '\"v1\"', assertCurrent: vi.fn().mockResolvedValue(undefined), close: vi.fn() } as unknown as PdfDocumentHandle;
}

describe("PDF 페이지의 보수적 판정", (): void => {
  it.each([OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask])("이미지 연산 %s를 텍스트와 독립 분류한다", (operator: number): void => {
    const evidence: PdfPageEvidence = Object.freeze({ hasText: true, operators: Object.freeze([operator]), annotationCount: 0 });
    const first = classifyPdfPage(evidence, OPS);
    expect(first).toMatchObject({ kind: "text-image", hasImage: true, hasText: true, requiresOriginalCheck: true });
    expect(classifyPdfPage(evidence, OPS)).toEqual(first);
    expect(evidence).toEqual({ hasText: true, operators: [operator], annotationCount: 0 });
  });
  it.each([OPS.stroke, OPS.clip, OPS.setFillRGBColor, OPS.paintFormXObjectBegin, 99999])("일반·지원 불명 연산 %s는 이미지나 빈 페이지로 오인하지 않는다", (operator: number): void => {
    expect(classifyPdfPage({ hasText: false, operators: [operator], annotationCount: 0 }, OPS)).toMatchObject({ kind: "no-text", hasImage: false });
  });
  it("주석이 있으면 빈 페이지가 아니며 무내용만 빈 페이지로 분류한다", (): void => {
    expect(classifyPdfPage({ hasText: false, operators: [], annotationCount: 1 }, OPS).kind).toBe("no-text");
    expect(classifyPdfPage({ hasText: false, operators: [], annotationCount: 0 }, OPS).kind).toBe("blank");
  });
  it("합성 혼합 PDF를 실제 설치된 PDF.js로 페이지별 판정하며 추출 결과와 일치한다", async (): Promise<void> => {
    const loading = getDocument({ data: Uint8Array.from(extractionPdf()), useSystemFonts: true, disableFontFace: true, stopAtErrors: true });
    const document = await loading.promise;
    const handle: PdfDocumentHandle = { document, imageOperators: OPS, etag: '\"synthetic\"', assertCurrent: vi.fn().mockResolvedValue(undefined), close: async (): Promise<void> => { await loading.destroy(); } };
    const selected: SelectionBinding = { ...binding, selection: { ...binding.selection, pages: Array.from({ length: 7 }, (_: unknown, index: number) => ({ filePage: index + 1, purpose: "study" as const })) } };
    const expected: readonly string[] = ["text", "image", "blank", "text-image", "no-text", "no-text", "no-text"];
    try {
      const analyses: PdfPageAnalysis[] = [];
      await analyzeSelectedPdfPages(handle, selected, new AbortController().signal, (analysis: PdfPageAnalysis): void => { analyses.push(analysis); });
      expect(analyses.map((analysis): string => analysis.status === "ready" ? analysis.content.features.kind : analysis.error)).toEqual(expected);
      for (const analysis of analyses) {
        if (analysis.status !== "ready") throw new Error(analysis.error);
        expect(await extractPdfPage(handle, selected, analysis.filePage, new AbortController().signal)).toEqual(analysis.result);
        expect(analysis.result.requiresConfirmation).toBe(true);
      }
    } finally { await handle.close(); }
  });
  it("주석 조회 실패를 빈 페이지로 은폐하지 않는다", async (): Promise<void> => {
    const page: PDFPageProxy = emptyPage(); vi.mocked(page.getAnnotations).mockRejectedValue(new Error("annotation-broken"));
    const analysis: PdfPageAnalysis = await analyzePdfPage(fixtureHandle(page), binding, 1, new AbortController().signal);
    expect(analysis).toMatchObject({ status: "failed", result: { status: "failed" } });
    if (analysis.status !== "failed") throw new Error("실패 상태가 필요합니다.");
    expect(analysis.error).toContain("파일 1페이지 주석 분석 실패"); expect(analysis.error).toContain("annotation-broken"); expect(page.cleanup).toHaveBeenCalledOnce();
  });
  it("원본 변경은 실패 결과조차 저장하지 않는다", async (): Promise<void> => {
    const page: PDFPageProxy = emptyPage(); const handle: PdfDocumentHandle = fixtureHandle(page); const save = vi.fn();
    vi.mocked(handle.assertCurrent).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("원본 버전 변경"));
    await expect(extractSelectedText(handle, binding, new AbortController().signal, save)).rejects.toThrow("원본 버전 변경");
    expect(save).not.toHaveBeenCalled(); expect(page.cleanup).toHaveBeenCalledOnce(); expect(handle.document.getPage).toHaveBeenCalledTimes(1);
  });
  it("지연된 분석 중 취소하면 결과와 다음 페이지를 반영하지 않는다", async (): Promise<void> => {
    const page: PDFPageProxy = emptyPage(); const handle: PdfDocumentHandle = fixtureHandle(page); const stop: AbortController = new AbortController(); const apply = vi.fn();
    let release!: (value: Awaited<ReturnType<PDFPageProxy["getOperatorList"]>>) => void;
    vi.mocked(page.getOperatorList).mockReturnValue(new Promise((resolve): void => { release = resolve; }));
    const work: Promise<void> = analyzeSelectedPdfPages(handle, binding, stop.signal, apply);
    const rejected = expect(work).rejects.toThrow("선택 변경");
    await vi.waitFor((): void => { expect(page.getOperatorList).toHaveBeenCalledOnce(); });
    stop.abort(new Error("선택 변경")); release({ fnArray: [], argsArray: [] }); await rejected;
    expect(apply).not.toHaveBeenCalled(); expect(handle.document.getPage).toHaveBeenCalledTimes(1); expect(page.cleanup).toHaveBeenCalledOnce();
  });
  it("선택 밖 페이지와 시작 전에 취소된 작업은 읽지 않는다", async (): Promise<void> => {
    const handle: PdfDocumentHandle = fixtureHandle(emptyPage());
    await expect(analyzePdfPage(handle, binding, 3, new AbortController().signal)).rejects.toThrow("선택하지 않은");
    const stop: AbortController = new AbortController(); stop.abort(new Error("취소됨"));
    await expect(analyzePdfPage(handle, binding, 1, stop.signal)).rejects.toThrow("취소됨");
    expect(handle.document.getPage).not.toHaveBeenCalled();
  });
});
