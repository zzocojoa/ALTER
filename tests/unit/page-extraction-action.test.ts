import { describe, expect, it } from "vitest";
import { matchesResultTarget, resultTarget } from "../../app/learn/materials/result-navigation";
import { canExtractPdfText, pageExtractionAction } from "../../app/learn/materials/page-extraction-action";
import type { PdfPageAnalysis } from "../../app/learn/materials/analyze-pdf-page";
import type { PdfPageFeatures } from "../../lib/extraction/pdf-analysis";
import type { StoredExtractionPage } from "../../lib/extraction/state";
import type { PageResult } from "../../lib/extraction/result";

const result: PageResult = { filePage: 1, method: "text-layer", status: "complete", width: 100, height: 100, rotation: 0, segments: [{ id: "s0", kind: "text", text: "합성 자료", bounds: null, transform: null, uncertain: true, reason: "원본 대조" }], error: null, requiresConfirmation: true };
const page: StoredExtractionPage = { id: "00000000-0000-4000-8000-000000000001", jobId: "00000000-0000-4000-8000-000000000002", selectionRevision: 1, filePage: 1, version: 1, resultVersion: 0, resultId: null, state: "pending", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: null };
function analysis(kind: PdfPageFeatures["kind"]): PdfPageAnalysis {
  return { filePage: 1, status: "ready", result, content: { features: { kind, hasText: kind === "text" || kind === "text-image", hasImage: kind === "image" || kind === "text-image", operatorCount: 1, annotationCount: 0, analysisComplete: true, requiresOriginalCheck: true }, text: "합성 자료", items: [], geometry: { width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100] }, rotation: 0 } };
}
describe("페이지별 다음 행동", (): void => {
  it("결과 이동은 파일 페이지·선택·결과 판을 구별하고 인쇄 쪽수에는 좌우되지 않는다", (): void => {
    const saved: StoredExtractionPage = { ...page, state: "complete", resultId: page.id, resultVersion: 2, result, printedPage: "ix" };
    const target = resultTarget(saved, "result");
    expect(matchesResultTarget({ ...saved, printedPage: "23" }, target)).toBe(true);
    for (const changed of [{ ...saved, filePage: 2 }, { ...saved, selectionRevision: 2 }, { ...saved, resultId: page.jobId }, { ...saved, resultVersion: 3 }]) expect(matchesResultTarget(changed, target)).toBe(false);
  });
  it.each([['text', 'extract'], ['text-image', 'extract'], ['image', 'prepare'], ['blank', 'original'], ['no-text', 'original']] as const)("%s는 %s로 이어진다", (kind, action): void => {
    const before: string = JSON.stringify(page);
    expect(pageExtractionAction(page, analysis(kind)).kind).toBe(action); expect(JSON.stringify(page)).toBe(before);
  });
  it.each(["running", "unknown"] as const)("%s는 기존 요청 확인이 우선이다", (state): void => {
    expect(pageExtractionAction({ ...page, state, result }, analysis("image")).kind).toBe("recover");
    expect(canExtractPdfText({ ...page, state }, analysis("text"))).toBe(false);
  });
  it("실패 후 이전 결과가 있어도 재추출로 덮어쓰지 않는다", (): void => {
    const saved: StoredExtractionPage = { ...page, state: "failed", result, resultId: page.id, resultVersion: 1 };
    expect(pageExtractionAction(saved, analysis("text")).kind).toBe("saved"); expect(canExtractPdfText(saved, analysis("text"))).toBe(false);
  });
  it("혼합 선택에서 텍스트만 허용하며 분석 실패에는 재시도를 제공한다", (): void => {
    expect(["text", "image", "blank", "text-image", "no-text"].map((kind): boolean => canExtractPdfText(page, analysis(kind as PdfPageFeatures["kind"])))).toEqual([true, false, false, true, false]);
    expect(pageExtractionAction(page, { filePage: 1, status: "failed", result: { ...result, status: "failed", segments: [], error: "읽기 실패" }, error: "읽기 실패" })).toMatchObject({ kind: "retry", description: "읽기 실패" });
    expect(pageExtractionAction(page, null).kind).toBe("analyze");
  });
});
