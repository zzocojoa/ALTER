import type { PageInput, SourceInput } from "../../db/repositories/materials.ts";
import type { ExtractedSegment, PageResult } from "./result.ts";
import type { StoredExtractionPage } from "./state.ts";

export type ExtractionSource = Readonly<SourceInput & { ownerId: string; originalVersion: string; originalHash: string; selectionRevision: number; resultVersion: number; segmentId: string; extractionPageId: string }>;
export type SourceSnapshot = Readonly<{ ownerId: string; materialId: string; uploadId: string; originalVersion: string; originalHash: string; selectionRevision: number; page: StoredExtractionPage }>;
export type SourceRejection = "deleted" | "other-owner" | "material-mismatch" | "original-replaced" | "stale-result" | "wrong-page" | "segment-missing" | "unreadable" | "unconfirmed" | "outside-span";
export type SourceJudgment = Readonly<{ valid: true; source: SourceInput; page: PageInput }> | Readonly<{ valid: false; reason: SourceRejection }>;
export type SegmentSpan = Readonly<{ segment: ExtractedSegment; start: number; end: number }>;

/** SQLite와 같은 유니코드 코드 포인트 단위를 사용합니다. 인쇄 쪽수는 범위 식별에 사용하지 않습니다. */
export function segmentSpans(result: PageResult): readonly SegmentSpan[] {
  return result.segments.map((segment: ExtractedSegment, index: number): SegmentSpan => {
    const start: number = result.segments.slice(0, index).reduce((offset: number, previous: ExtractedSegment): number => offset + Array.from(previous.text).length + 1, 0);
    return { segment, start, end: start + Array.from(segment.text).length };
  });
}

/** 저장된 현재 원본·결과·구간·확인 상태와 인용을 대조하는 부작용 없는 판정입니다. */
export function judgeExtractionSource(source: ExtractionSource, snapshot: SourceSnapshot | null): SourceJudgment {
  if (snapshot === null) return { valid: false, reason: "deleted" };
  if (source.ownerId !== snapshot.ownerId) return { valid: false, reason: "other-owner" };
  if (source.materialId !== snapshot.materialId || source.uploadId !== snapshot.uploadId) return { valid: false, reason: "material-mismatch" };
  if (source.originalVersion !== snapshot.originalVersion || source.originalHash !== snapshot.originalHash) return { valid: false, reason: "original-replaced" };
  const page: StoredExtractionPage = snapshot.page;
  if (source.filePage !== page.filePage || source.extractionPageId !== page.id) return { valid: false, reason: "wrong-page" };
  if (source.selectionRevision !== snapshot.selectionRevision || source.selectionRevision !== page.selectionRevision || source.pageId !== page.resultId || source.resultVersion !== page.resultVersion || page.state !== "complete" || page.result === null) return { valid: false, reason: "stale-result" };
  const span: SegmentSpan | undefined = segmentSpans(page.result).find((item): boolean => item.segment.id === source.segmentId);
  if (span === undefined) return { valid: false, reason: "segment-missing" };
  if (span.segment.kind === "unreadable" || !span.segment.text.trim()) return { valid: false, reason: "unreadable" };
  if (!page.confirmedSegmentIds.includes(source.segmentId)) return { valid: false, reason: "unconfirmed" };
  const content: string = page.result.segments.map((segment): string => segment.text).join("\n");
  if (!Number.isSafeInteger(source.spanStart) || !Number.isSafeInteger(source.spanEnd) || source.spanStart < span.start || source.spanEnd > span.end || source.spanEnd <= source.spanStart || Array.from(content).slice(source.spanStart, source.spanEnd).join("") !== source.evidence) return { valid: false, reason: "outside-span" };
  return { valid: true, source: { id: source.id, materialId: source.materialId, uploadId: source.uploadId, pageId: source.pageId, filePage: source.filePage, printedPage: page.printedPage, spanStart: source.spanStart, spanEnd: source.spanEnd, evidence: source.evidence }, page: { id: source.pageId, materialId: source.materialId, uploadId: source.uploadId, filePage: source.filePage, printedPage: page.printedPage, content } };
}
