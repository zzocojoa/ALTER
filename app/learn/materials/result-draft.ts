import type { PageSaveState, PageSaveAttempt } from "./page-save";
import type { StoredExtractionPage } from "@/lib/extraction/state";

type CorrectionSegment = Readonly<{ id: string; text: string }>;
export type CorrectionDraft = Readonly<{ resultId: string | null; resultVersion: number; segments: readonly CorrectionSegment[] }>;
export type ConfirmationDraft = Readonly<{ resultId: string | null; segmentIds: readonly string[]; compared: boolean }>;
export type ResultDraft = Readonly<{ printedPage: string | null; correction: CorrectionDraft | null; confirmation: ConfirmationDraft | null; save: PageSaveState }>;
export const emptyResultDraft: ResultDraft = { printedPage: null, correction: null, confirmation: null, save: { kind: "idle" } };

export function correctionOf(page: StoredExtractionPage, draft: ResultDraft): CorrectionDraft {
  return draft.correction ?? { resultId: page.resultId, resultVersion: page.resultVersion, segments: page.result?.segments.length ? page.result.segments.map((segment): CorrectionSegment => ({ id: segment.id, text: segment.text })) : [{ id: "s0", text: "" }] };
}
/** 확인 선택은 동일한 결과 판에만 적용하고 새 판에는 넘기지 않습니다. */
export function confirmationOf(page: StoredExtractionPage, draft: ResultDraft): ConfirmationDraft {
  return draft.confirmation?.resultId === page.resultId ? draft.confirmation : { resultId: page.resultId, segmentIds: [], compared: false };
}
export function replaceCorrection(page: StoredExtractionPage, draft: ResultDraft, id: string, text: string): ResultDraft {
  const correction: CorrectionDraft = correctionOf(page, draft);
  return { ...draft, correction: { ...correction, segments: correction.segments.map((segment): CorrectionSegment => segment.id === id ? { ...segment, text } : segment) } };
}
export function selectConfirmation(page: StoredExtractionPage, draft: ResultDraft, id: string, checked: boolean): ResultDraft {
  const confirmation: ConfirmationDraft = confirmationOf(page, draft);
  return { ...draft, confirmation: { ...confirmation, segmentIds: checked ? [...new Set([...confirmation.segmentIds, id])] : confirmation.segmentIds.filter((segmentId): boolean => segmentId !== id) } };
}

export function completedResultDraft(draft: ResultDraft, attempt: PageSaveAttempt, message: string): ResultDraft {
  const intent = attempt.intent;
  return { ...draft, save: { kind: "saved", message },
    printedPage: intent.kind === "label" && (draft.printedPage?.trim() || null) === intent.printedPage ? null : draft.printedPage,
    correction: intent.kind === "edit" && draft.correction?.resultId === attempt.resultId && JSON.stringify(draft.correction.segments) === JSON.stringify(intent.segments) ? null : draft.correction,
    confirmation: intent.kind === "edit" || intent.kind === "confirm" ? null : draft.confirmation,
  };
}
