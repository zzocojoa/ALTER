import type { OPS } from "pdfjs-dist";
import type { PageResult } from "./result";

export type PdfImageOperators = Readonly<Pick<typeof OPS, "paintImageMaskXObject" | "paintImageMaskXObjectGroup" | "paintImageXObject" | "paintInlineImageXObject" | "paintInlineImageXObjectGroup" | "paintImageXObjectRepeat" | "paintImageMaskXObjectRepeat" | "paintSolidColorImageMask">>;
export type PdfPageEvidence = Readonly<{ hasText: boolean; operators: readonly number[]; annotationCount: number }>;
export type PdfPageFeatures = Readonly<{ kind: "text" | "image" | "text-image" | "blank" | "no-text"; hasText: boolean; hasImage: boolean; operatorCount: number; annotationCount: number; analysisComplete: true; requiresOriginalCheck: true }>;

/** 이미지 연산과 텍스트를 독립 판정하며 연산·주석이 전혀 없을 때만 빈 페이지로 분류합니다. */
export function classifyPdfPage(evidence: PdfPageEvidence, images: PdfImageOperators): PdfPageFeatures {
  if (!Number.isInteger(evidence.annotationCount) || evidence.annotationCount < 0) throw new RangeError("PDF 주석 개수를 확인할 수 없어요.");
  const imageCodes: readonly number[] = [images.paintImageMaskXObject, images.paintImageMaskXObjectGroup, images.paintImageXObject, images.paintInlineImageXObject, images.paintInlineImageXObjectGroup, images.paintImageXObjectRepeat, images.paintImageMaskXObjectRepeat, images.paintSolidColorImageMask];
  const hasImage: boolean = evidence.operators.some((operator: number): boolean => imageCodes.includes(operator));
  const kind: PdfPageFeatures["kind"] = evidence.hasText ? hasImage ? "text-image" : "text" : hasImage ? "image" : evidence.operators.length === 0 && evidence.annotationCount === 0 ? "blank" : "no-text";
  return { kind, hasText: evidence.hasText, hasImage, operatorCount: evidence.operators.length, annotationCount: evidence.annotationCount, analysisComplete: true, requiresOriginalCheck: true };
}

/** 분석 특성을 기존 저장 결과 계약으로 옮기며 내용 확인 완료를 뜻하지 않습니다. */
export function pdfTextResultStatus(features: PdfPageFeatures): PageResult["status"] {
  return features.hasText ? "complete" : features.kind === "blank" ? "blank" : "no-text";
}
