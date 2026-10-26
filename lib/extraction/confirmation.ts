import { z } from "zod";
import { materialFailure } from "../materials/policy.ts";
import { validatePageResult } from "./result.ts";
import type { ExtractedSegment, PageResult } from "./result.ts";
import type { StoredExtractionPage } from "./state.ts";

export const confirmationInput = z.object({ selectionRevision: z.number().int().positive(), filePage: z.number().int().positive(), expectedVersion: z.number().int().positive(), resultId: z.string().uuid(), segmentIds: z.array(z.string().regex(/^s[0-9]{1,4}$/)).min(1).max(1000), printedPage: z.string().trim().max(40).nullable(), comparedWithOriginal: z.literal(true) }).strict();
export type ConfirmationInput = Readonly<z.infer<typeof confirmationInput>>;
export const correctionInput = confirmationInput.omit({ segmentIds: true, printedPage: true, comparedWithOriginal: true }).extend({ segments: z.array(z.object({ id: z.string().regex(/^s[0-9]{1,4}$/), text: z.string().max(60000) }).strict()).min(1).max(1000) }).strict();
export type CorrectionInput = Readonly<z.infer<typeof correctionInput>>;

/** 확인 가능한 내용만 선택하며 읽을 수 없는 구간은 확인으로 승격하지 않습니다. */
export function requireConfirmableSegments(page: StoredExtractionPage, input: ConfirmationInput): readonly ExtractedSegment[] {
  confirmationInput.parse(input);
  if (page.state !== "complete" || page.resultId !== input.resultId || page.result === null || page.result.status !== "complete" || page.selectionRevision !== input.selectionRevision || page.filePage !== input.filePage) throw materialFailure("material_version_conflict", "confirmation-current-result", 409);
  if (new Set(input.segmentIds).size !== input.segmentIds.length) throw materialFailure("material_request_invalid", "confirmation-duplicate-segment", 400);
  return input.segmentIds.map((id: string): ExtractedSegment => {
    const segment: ExtractedSegment | undefined = page.result?.segments.find((item): boolean => item.id === id);
    if (segment === undefined || segment.kind === "unreadable" || segment.text.trim() === "") throw materialFailure("material_request_invalid", "confirmation-unreadable-segment", 400);
    return segment;
  });
}

export function correctedPage(page: StoredExtractionPage, value: CorrectionInput): PageResult {
  const input: CorrectionInput = correctionInput.parse(value);
  if (page.state !== "complete" || page.result === null || page.resultId !== input.resultId || page.selectionRevision !== input.selectionRevision || page.filePage !== input.filePage || new Set(input.segments.map((segment): string => segment.id)).size !== input.segments.length) throw materialFailure("material_version_conflict", "correction-current-result", 409);
  if (page.result.segments.length === 0) {
    if (input.segments.length !== 1 || input.segments[0].id !== "s0" || !input.segments[0].text.trim()) throw materialFailure("material_request_invalid", "correction-empty-transcription", 400);
    return validatePageResult({ ...page.result, method: "manual-correction", status: "complete", error: null, segments: [{ id: "s0", kind: "text", text: input.segments[0].text, bounds: page.result.width === null ? null : { x: 0, y: 0, width: 1, height: 1 }, transform: null, uncertain: true, reason: "사용자가 직접 전사한 내용입니다. 원본과 다시 대조해 주세요." }] }, page.filePage);
  }
  if (input.segments.some((change): boolean => !page.result?.segments.some((segment): boolean => segment.id === change.id))) throw materialFailure("material_request_invalid", "correction-missing-segment", 400);
  const segments: ExtractedSegment[] = page.result.segments.map((segment): ExtractedSegment => {
    const change = input.segments.find((item): boolean => item.id === segment.id);
    return change === undefined ? { ...segment, uncertain: true, reason: "수정본 전체를 원본과 다시 확인해 주세요." } : { ...segment, kind: segment.kind === "unreadable" ? "text" : segment.kind, text: change.text, uncertain: true, reason: "사용자가 수정한 내용입니다. 원본과 다시 대조해 주세요." };
  });
  return validatePageResult({ ...page.result, method: "manual-correction", status: "complete", segments, error: null, requiresConfirmation: true }, page.filePage);
}
