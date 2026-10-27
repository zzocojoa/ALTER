import { describe, expect, it } from "vitest";
import { recordId } from "../../lib/domain/contracts";
import { extractionProgress } from "../../app/learn/materials/extraction-progress";
import type { StoredExtractionPage } from "../../lib/extraction/state";
import type { SelectionInput } from "../../lib/extraction/selection";
import type { PageResult } from "../../lib/extraction/result";

const id: string = "00000000-0000-4000-a000-000000000001";
const selection: SelectionInput = { materialId: recordId.parse(id), originalVersion: "fixture", originalHash: "a".repeat(64), pages: [{ filePage: 1, purpose: "study" }] };
const result: PageResult = { filePage: 1, method: "plain-text", status: "complete", width: null, height: null, rotation: 0, segments: [{ id: "s0", kind: "text", text: "읽은 문장", bounds: null, transform: null, uncertain: false, reason: null }], error: null, requiresConfirmation: true };
const page: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 1, version: 2, resultVersion: 1, resultId: id, state: "complete", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result };

describe("추출 진행은 현재 서버 확인 기록만 따른다", (): void => {
  it("AI나 텍스트 추출 성공만으로 사용자 확인을 표시하지 않는다", (): void => {
    expect(extractionProgress(selection, [page])).toMatchObject({ phase: "compare", confirmed: false, confirmedSegments: 0, unconfirmedSegments: 1 });
  });
  it("현재 버전의 확인 구간만 확정으로 집계한다", (): void => {
    expect(extractionProgress(selection, [{ ...page, confirmedSegmentIds: ["s0"] }])).toMatchObject({ phase: "confirm", confirmed: true });
    expect(extractionProgress(selection, [{ ...page, version: 3, resultVersion: 2, confirmedSegmentIds: [] }])).toMatchObject({ confirmed: false, confirmedSegments: 0 });
  });
  it("선택을 변경하는 동안 과거 결과를 새 범위의 완료로 표시하지 않는다", (): void => {
    expect(extractionProgress(null, [{ ...page, confirmedSegmentIds: ["s0"] }])).toMatchObject({ phase: "select", selectedPages: 0, confirmed: false });
    expect(extractionProgress({ ...selection, pages: [{ filePage: 2, purpose: "study" }] }, [page])).toMatchObject({ phase: "extract", selectedPages: 1, extractedPages: 0, confirmed: false });
  });
  it("부분 추출과 결과 불명을 전체 추출 완료로 간주하지 않는다", (): void => {
    expect(extractionProgress({ ...selection, pages: [...selection.pages, { filePage: 2, purpose: "study" }] }, [page])).toMatchObject({ phase: "extract", extractedPages: 1, confirmed: false });
    expect(extractionProgress(selection, [{ ...page, state: "unknown", confirmedSegmentIds: ["s0"] }])).toMatchObject({ phase: "extract", extractedPages: 0, outcomeUnknownPages: 1, confirmed: false });
  });
  it("불확실한 구간은 사용자 대조 기록이 저장될 때까지 해결이 필요하다", (): void => {
    const uncertain: StoredExtractionPage = { ...page, result: { ...result, segments: [{ ...result.segments[0], uncertain: true, reason: "읽기 순서 확인" }] } };
    expect(extractionProgress(selection, [uncertain])).toMatchObject({ phase: "resolve", needsResolutionPages: 1, confirmed: false });
    expect(extractionProgress(selection, [{ ...uncertain, confirmedSegmentIds: ["s0"] }])).toMatchObject({ confirmed: true, needsResolutionPages: 0 });
  });
  it("텍스트가 없거나 판독 불가한 결과는 빈 완료로 표시하지 않는다", (): void => {
    expect(extractionProgress(selection, [{ ...page, result: { ...result, status: "no-text", segments: [] } }])).toMatchObject({ phase: "resolve", confirmed: false });
    expect(extractionProgress(selection, [{ ...page, result: { ...result, segments: [{ ...result.segments[0], kind: "unreadable", text: "", uncertain: true, reason: "흐림" }] } }])).toMatchObject({ phase: "resolve", confirmed: false });
  });
});
