import { describe, expect, it } from "vitest";
import { judgeExtractionSource, segmentSpans } from "../../lib/extraction/source";
import type { ExtractionSource, SourceRejection, SourceSnapshot } from "../../lib/extraction/source";
import { recordId } from "../../lib/domain/contracts";
import type { PageResult } from "../../lib/extraction/result";

const uuid = recordId.parse("11111111-1111-4111-8111-111111111111");
const result: PageResult = { filePage: 3, method: "text-layer", status: "complete", width: 100, height: 100, rotation: 0, segments: [{ id: "s0", kind: "text", text: "😀가", bounds: null, transform: null, uncertain: true, reason: "대조" }, { id: "s1", kind: "formula", text: "x²", bounds: null, transform: null, uncertain: true, reason: "대조" }], error: null, requiresConfirmation: true };
const snapshot: SourceSnapshot = { ownerId: "owner", materialId: uuid, uploadId: uuid, originalVersion: "v1", originalHash: "a".repeat(64), selectionRevision: 1, page: { id: uuid, jobId: uuid, filePage: 3, selectionRevision: 1, version: 2, resultVersion: 1, resultId: uuid, state: "complete", printedPage: "iii", pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: ["s0"], result } };
const source: ExtractionSource = { id: uuid, ownerId: "owner", materialId: uuid, uploadId: uuid, pageId: uuid, extractionPageId: uuid, filePage: 3, printedPage: "old-label", spanStart: 0, spanEnd: 2, evidence: "😀가", originalVersion: "v1", originalHash: "a".repeat(64), selectionRevision: 1, resultVersion: 1, segmentId: "s0" };
describe("현재 확인 구간 출처", () => {
  it("유니코드 범위와 표시 쪽수 변경을 보존한다", () => { const judgment = judgeExtractionSource(source, snapshot); expect(judgment.valid).toBe(true); if (judgment.valid) { expect(judgment.source.printedPage).toBe("iii"); expect(judgment.source.filePage).toBe(3); } expect(segmentSpans(result)[1].start).toBe(3); });
  const cases: readonly Readonly<{ patch: Partial<ExtractionSource>; reason: SourceRejection }>[] = [
    { patch: { ownerId: "other" }, reason: "other-owner" }, { patch: { materialId: recordId.parse("22222222-2222-4222-8222-222222222222") }, reason: "material-mismatch" },
    { patch: { filePage: 2 }, reason: "wrong-page" }, { patch: { originalVersion: "old" }, reason: "original-replaced" }, { patch: { originalHash: "b".repeat(64) }, reason: "original-replaced" },
    { patch: { resultVersion: 2 }, reason: "stale-result" }, { patch: { selectionRevision: 2 }, reason: "stale-result" }, { patch: { segmentId: "s9" }, reason: "segment-missing" },
    { patch: { segmentId: "s1", spanStart: 3, spanEnd: 5, evidence: "x²" }, reason: "unconfirmed" }, { patch: { spanEnd: 5, evidence: "😀가\nx²" }, reason: "outside-span" }, { patch: { evidence: "조작" }, reason: "outside-span" },
  ];
  for (const item of cases) it(item.reason + JSON.stringify(item.patch), () => { expect(judgeExtractionSource({ ...source, ...item.patch }, snapshot)).toEqual({ valid: false, reason: item.reason }); });
  it("삭제와 판독 불가를 구별한다", () => { expect(judgeExtractionSource(source, null)).toEqual({ valid: false, reason: "deleted" }); expect(judgeExtractionSource(source, { ...snapshot, page: { ...snapshot.page, result: { ...result, segments: [{ ...result.segments[0], kind: "unreadable" }] } } })).toEqual({ valid: false, reason: "unreadable" }); });
  it("결과 불명은 확정 출처로 반환하지 않는다", () => { expect(judgeExtractionSource(source, { ...snapshot, page: { ...snapshot.page, state: "unknown" } })).toEqual({ valid: false, reason: "stale-result" }); });
});
