import type { StoredExtractionPage } from "@/lib/extraction/state";
import type { ComparisonPane } from "./original-comparison";

export type ResultTarget = Readonly<{ pageId: string; selectionRevision: number; filePage: number; resultId: string | null; resultVersion: number; pane: ComparisonPane; purpose: "review" | "transcribe" }>;

export function resultTarget(page: StoredExtractionPage, pane: ComparisonPane): ResultTarget {
  return { pageId: page.id, selectionRevision: page.selectionRevision, filePage: page.filePage, resultId: page.resultId, resultVersion: page.resultVersion, pane, purpose: "review" };
}
export function transcriptionTarget(page: StoredExtractionPage): ResultTarget {
  return { ...resultTarget(page, "result"), purpose: "transcribe" };
}
export function matchesResultTarget(page: StoredExtractionPage, target: ResultTarget): boolean {
  return page.id === target.pageId && page.selectionRevision === target.selectionRevision && page.filePage === target.filePage && page.resultId === target.resultId && page.resultVersion === target.resultVersion;
}
