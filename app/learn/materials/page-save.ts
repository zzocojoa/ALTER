import type { PageResult } from "@/lib/extraction/result";
import type { StoredExtractionPage } from "@/lib/extraction/state";

import { requirePageResponse } from "./page-response";

type SaveSegment = Readonly<{ id: string; text: string }>;
export type PageSaveIntent = Readonly<{ kind: "text"; result: PageResult }> | Readonly<{ kind: "label"; printedPage: string | null }> | Readonly<{ kind: "edit"; segments: readonly SaveSegment[] }> | Readonly<{ kind: "transcribe"; segments: readonly SaveSegment[] }> | Readonly<{ kind: "confirm"; segmentIds: readonly string[]; comparedWithOriginal: true; printedPage: string | null }>;
export type PageSaveAttempt = Readonly<{ pageId: string; jobId: string; selectionRevision: number; filePage: number; expectedVersion: number; resultId: string | null; resultVersion: number; requestKey: string; intent: PageSaveIntent }>;
export type PageSaveState = Readonly<{ kind: "idle" }> | Readonly<{ kind: "saving"; attempt: PageSaveAttempt }> | Readonly<{ kind: "unconfirmed" | "checked"; attempt: PageSaveAttempt; message: string }> | Readonly<{ kind: "saved"; message: string }>;

export function pageSaveAttempt(page: StoredExtractionPage, intent: PageSaveIntent, requestKey: string): PageSaveAttempt {
  return { pageId: page.id, jobId: page.jobId, selectionRevision: page.selectionRevision, filePage: page.filePage, expectedVersion: page.version, resultId: page.resultId, resultVersion: page.resultVersion, requestKey, intent };
}
export function pageSavePayload(attempt: PageSaveAttempt): Readonly<{ selectionRevision: number; filePage: number; expectedVersion: number }> & (Readonly<{ result: PageResult }> | Readonly<{ printedPage: string | null }> | Readonly<{ intent?: "transcribe"; resultId: string | null; segments: readonly SaveSegment[] }> | Readonly<{ resultId: string | null; segmentIds: readonly string[]; comparedWithOriginal: true; printedPage: string | null }>) {
  const binding = { selectionRevision: attempt.selectionRevision, filePage: attempt.filePage, expectedVersion: attempt.expectedVersion };
  const intent: PageSaveIntent = attempt.intent;
  if (intent.kind === "text") return { ...binding, result: intent.result };
  if (intent.kind === "label") return { ...binding, printedPage: intent.printedPage };
  if (intent.kind === "transcribe") return { ...binding, intent: "transcribe", resultId: attempt.resultId, segments: intent.segments };
  if (intent.kind === "edit") return { ...binding, resultId: attempt.resultId, segments: intent.segments };
  return { ...binding, resultId: attempt.resultId, segmentIds: intent.segmentIds, comparedWithOriginal: intent.comparedWithOriginal, printedPage: intent.printedPage };
}
export function requireSavedPageBinding(page: StoredExtractionPage, attempt: PageSaveAttempt): void {
  requirePageResponse(page, { id: attempt.pageId, jobId: attempt.jobId, selectionRevision: attempt.selectionRevision, filePage: attempt.filePage, version: attempt.expectedVersion, resultVersion: attempt.resultVersion });
}
/** 요청 성공을 추정하지 않고 현재 저장값이 의도한 내용과 일치하는지 확인합니다. */
export function savedPageMatches(page: StoredExtractionPage, attempt: PageSaveAttempt): boolean {
  requireSavedPageBinding(page, attempt);
  if (page.version <= attempt.expectedVersion) return false;
  const intent: PageSaveIntent = attempt.intent;
  if (intent.kind === "text") return page.state === (intent.result.status === "failed" ? "failed" : "complete") && page.resultVersion > attempt.resultVersion && page.resultId !== attempt.resultId && JSON.stringify(page.result) === JSON.stringify(intent.result);
  if (intent.kind === "label") return page.printedPage === intent.printedPage;
  if (intent.kind === "confirm") return page.state === "complete" && page.resultId === attempt.resultId && intent.segmentIds.every((id): boolean => page.confirmedSegmentIds.includes(id)) && page.printedPage === intent.printedPage;
  return page.state === "complete" && page.result?.method === "manual-correction" && page.resultVersion > attempt.resultVersion && page.resultId !== attempt.resultId && page.result.segments.length === intent.segments.length && intent.segments.every((segment): boolean => page.result?.segments.some((saved): boolean => saved.id === segment.id && saved.text === segment.text) === true);
}
export function pageSaveLabel(intent: PageSaveIntent): string { return intent.kind === "text" ? "텍스트 추출" : intent.kind === "label" ? "인쇄 쪽수" : intent.kind === "transcribe" ? "직접 전사" : intent.kind === "edit" ? "수정 본문" : "원본 대조 확인"; }
