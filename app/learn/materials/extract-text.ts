import { validatePageResult } from "@/lib/extraction/result";
import type { PageResult } from "@/lib/extraction/result";
import { requireSelectedPage } from "@/lib/extraction/selection";
import type { SelectionBinding } from "@/lib/extraction/selection";
import type { PdfDocumentHandle } from "./pdf-document";
import { hashFile } from "@/lib/learning-upload";
import type { MaterialCard } from "@/lib/materials/library";
import { requireMaterialResponse } from "./client-api";
import { analyzePdfPage } from "./analyze-pdf-page";
import type { PdfPageAnalysis } from "./analyze-pdf-page";

/** 선택한 한 페이지만 읽으며 실패는 다른 페이지의 결과와 분리합니다. */
export async function extractPdfPage(handle: PdfDocumentHandle, binding: SelectionBinding, filePage: number, signal: AbortSignal): Promise<PageResult> {
  const analysis: PdfPageAnalysis = await analyzePdfPage(handle, binding, filePage, signal);
  return analysis.result;
}

/** 한 페이지의 저장이 끝난 뒤 다음 선택 페이지를 읽어 메모리와 재개 범위를 제한합니다. */
export async function extractSelectedText(handle: PdfDocumentHandle, binding: SelectionBinding, signal: AbortSignal, storePage: (result: PageResult) => Promise<void>): Promise<void> {
  for (const page of binding.selection.pages) {
    signal.throwIfAborted();
    const result: PageResult = await extractPdfPage(handle, binding, page.filePage, signal);
    signal.throwIfAborted();
    await storePage(result);
  }
}

/** 텍스트 원본도 해시와 선택 페이지를 대조하며 길이를 자동으로 자르지 않습니다. */
export async function extractPlainText(material: MaterialCard, binding: SelectionBinding, signal: AbortSignal): Promise<PageResult> {
  requireSelectedPage(binding, material.id, binding.revision, 1);
  const response: Response = await fetch(material.file.sourceUrl, { cache: "no-store",signal }); await requireMaterialResponse(response);
  const bytes: ArrayBuffer = await response.arrayBuffer();
  if (bytes.byteLength !== material.file.bytes || await hashFile(bytes) !== binding.selection.originalHash) throw new Error("텍스트 원본 크기 또는 해시가 바뀌었어요. 다시 선택해 주세요.");
  const text: string = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (Array.from(text).length > 60000) throw new Error("선택 구간은 60,000자 이하여야 해요. 필요한 텍스트를 별도 자료로 등록해 주세요.");
  return validatePageResult({ filePage: 1,method: "plain-text",status: text.trim() ? "complete" : "blank",width: null,height: null,rotation: 0,segments: text.trim() ? [{ id: "s0",kind: "text",text,bounds: null,transform: null,uncertain: false,reason: null }] : [],error: null,requiresConfirmation: true },1);
}
