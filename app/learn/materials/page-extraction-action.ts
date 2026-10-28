import type { StoredExtractionPage } from "@/lib/extraction/state";
import type { PdfPageAnalysis } from "./analyze-pdf-page";

type PageAction = Readonly<{ kind: "analyze" | "extract" | "prepare" | "original" | "retry" | "saved" | "recover"; label: string; description: string }>;

/** 저장된 결과를 보호하면서 로컬 분석에 맞는 다음 행동만 계산합니다. */
export function pageExtractionAction(page: StoredExtractionPage, analysis: PdfPageAnalysis | null): PageAction {
  if (page.state === "running" || page.state === "unknown") return { kind: "recover", label: "기존 판독 결과 확인", description: page.state === "running" ? "AI 판독 처리 중이에요. 기존 요청을 먼저 확인해 주세요." : "판독 결과가 불명확해요. 재전송 전에 저장 상태를 확인해 주세요." };
  if (page.result !== null && page.result.status === "complete") return { kind: "saved", label: "저장된 결과 확인", description: page.state === "failed" ? "최근 요청은 실패했어요. 이전 저장 결과를 확인할 수 있어요." : "저장된 결과가 있어요. 원본과 대조해 확인해 주세요." };
  if (analysis === null) return { kind: "analyze", label: "페이지 분석 다시 시도", description: "페이지의 텍스트층과 이미지를 확인하고 있어요." };
  if (analysis.status === "failed") return { kind: "retry", label: "이 페이지 분석 다시 시도", description: analysis.error };
  const kind = analysis.content.features.kind;
  if (kind === "blank") return { kind: "original", label: "원본 확인", description: "텍스트·그림·주석이 없는 빈 페이지로 확인됐어요." };
  if (kind === "image") return { kind: "prepare", label: `파일 ${page.filePage}페이지 이미지 준비`, description: "텍스트층이 없는 이미지 페이지예요." };
  if (kind === "no-text") return { kind: "original", label: "원본 확인", description: "텍스트층이 없어요. 원본 확인이 필요한 페이지예요." };
  if (!canExtractPdfText(page, analysis)) return { kind: "saved", label: "저장된 결과 확인", description: "저장된 결과를 원본과 대조하거나 직접 수정해 주세요." };
  return { kind: "extract", label: `파일 ${page.filePage}페이지 텍스트 추출`, description: kind === "text-image" ? "텍스트와 이미지가 함께 있어요. 텍스트층에 없는 내용은 원본에서 확인해 주세요." : "텍스트층이 있어요. 무료로 추출한 뒤 원본과 대조해 주세요." };
}

export function canExtractPdfText(page: StoredExtractionPage, analysis: PdfPageAnalysis | null): boolean {
  return ["pending", "failed"].includes(page.state) && (page.result === null || page.result.status === "failed") && analysis?.status === "ready" && analysis.content.features.hasText;
}
