import type { PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { classifyPdfPage, pdfTextResultStatus } from "@/lib/extraction/pdf-analysis";
import type { PdfImageOperators, PdfPageFeatures } from "@/lib/extraction/pdf-analysis";
import { positionText, validatePageResult } from "@/lib/extraction/result";
import type { PageGeometry, PageResult, PositionedText } from "@/lib/extraction/result";
import { requireSelectedPage } from "@/lib/extraction/selection";
import type { SelectionBinding } from "@/lib/extraction/selection";
import type { PdfDocumentHandle } from "./pdf-document";
import { errorText } from "./client-api";

export type PdfPageContent = Readonly<{ features: PdfPageFeatures; text: string; items: readonly PositionedText[]; geometry: PageGeometry; rotation: number }>;
export type PdfPageAnalysis = Readonly<{ filePage: number; status: "ready"; content: PdfPageContent; result: PageResult }> | Readonly<{ filePage: number; status: "failed"; result: PageResult; error: string }>;

/** 호출자가 페이지를 소유하고 정리하며 분석기는 텍스트·연산·주석만 읽습니다. */
export async function readPdfPageContent(page: PDFPageProxy, filePage: number, images: PdfImageOperators, signal: AbortSignal): Promise<PdfPageContent> {
  let stage: string = "페이지 좌표";
  try {
    signal.throwIfAborted();
    const viewport = page.getViewport({ scale: 1 });
    stage = "텍스트층";
    const content = await page.getTextContent({ disableNormalization: true });
    signal.throwIfAborted();
    const items: readonly TextItem[] = content.items.filter((item): item is TextItem => "str" in item);
    const hasText: boolean = items.some((item: TextItem): boolean => item.str.trim().length > 0);
    stage = "그리기 연산";
    const operators = await page.getOperatorList({ annotationMode: 0 });
    signal.throwIfAborted();
    stage = "주석";
    const annotations: readonly unknown[] = await page.getAnnotations({ intent: "any" });
    signal.throwIfAborted();
    const features: PdfPageFeatures = classifyPdfPage({ hasText, operators: operators.fnArray, annotationCount: annotations.length }, images);
    return { features, text: items.map((item: TextItem): string => item.str + (item.hasEOL ? "\n" : " ")).join(""), items, geometry: { width: viewport.width, height: viewport.height, transform: [...viewport.transform] }, rotation: ((page.rotate % 360) + 360) % 360 };
  } catch (cause: unknown) {
    signal.throwIfAborted();
    throw Object.assign(new Error(`파일 ${filePage}페이지 ${stage} 분석 실패: ${errorText(cause)}`, { cause }), { name: "PdfPageAnalysisError" });
  }
}

/** 선택된 페이지만 분석하며 취소·원본 변경은 저장 가능한 페이지 실패와 구분합니다. */
export async function analyzePdfPage(handle: PdfDocumentHandle, binding: SelectionBinding, filePage: number, signal: AbortSignal): Promise<PdfPageAnalysis> {
  requireSelectedPage(binding, binding.jobId, binding.revision, filePage);
  signal.throwIfAborted();
  await handle.assertCurrent(signal);
  signal.throwIfAborted();
  let page: PDFPageProxy | null = null;
  let analysis: PdfPageAnalysis;
  try {
    page = await handle.document.getPage(filePage);
    signal.throwIfAborted();
    const content: PdfPageContent = await readPdfPageContent(page, filePage, handle.imageOperators, signal);
    const segments = content.features.hasText ? positionText(content.items, content.geometry) : [];
    const result: PageResult = validatePageResult({ filePage, method: "text-layer", status: pdfTextResultStatus(content.features), width: content.geometry.width, height: content.geometry.height, rotation: content.rotation, segments, error: null, requiresConfirmation: true }, filePage);
    analysis = { filePage, status: "ready", content, result };
  } catch (cause: unknown) {
    signal.throwIfAborted();
    const error: string = `파일 ${filePage}페이지 분석: ${errorText(cause)}`.slice(0, 1000);
    const result: PageResult = validatePageResult({ filePage, method: "text-layer", status: "failed", width: null, height: null, rotation: 0, segments: [], error, requiresConfirmation: true }, filePage);
    analysis = { filePage, status: "failed", result, error };
  } finally { page?.cleanup(); }
  await handle.assertCurrent(signal);
  signal.throwIfAborted();
  return analysis;
}

/** 한 페이지 분석이 반영된 후 다음 선택 페이지를 읽고 전체 원본을 임의 순회하지 않습니다. */
export async function analyzeSelectedPdfPages(handle: PdfDocumentHandle, binding: SelectionBinding, signal: AbortSignal, onAnalyzed: (analysis: PdfPageAnalysis) => void): Promise<void> {
  for (const selected of binding.selection.pages) {
    signal.throwIfAborted();
    const analysis: PdfPageAnalysis = await analyzePdfPage(handle, binding, selected.filePage, signal);
    signal.throwIfAborted();
    onAnalyzed(analysis);
  }
}
