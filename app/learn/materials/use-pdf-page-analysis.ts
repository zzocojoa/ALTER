"use client";

import { useEffect, useState } from "react";
import type { MaterialCard } from "@/lib/materials/library";
import type { SelectionBinding } from "@/lib/extraction/selection";
import { analyzeSelectedPdfPages } from "./analyze-pdf-page";
import type { PdfPageAnalysis } from "./analyze-pdf-page";
import { openPdfDocument } from "./pdf-document";
import { errorText } from "./client-api";

type AnalysisRequest = Readonly<{ selectionKey: string; filePage: number; generation: number }>;
type AnalysisSnapshot = Readonly<{ selectionKey: string; requestKey: string; pages: readonly PdfPageAnalysis[]; complete: boolean; failure: string | null }>;
export type SelectedPdfAnalysis = Readonly<{ pages: readonly PdfPageAnalysis[]; analyzing: boolean; failure: string | null; retry: (filePage: number) => void }>;

/** 선택·원본이 바뀌면 이전 분석을 숨기고 중단하며 실패한 페이지만 명시적으로 다시 읽습니다. */
export function usePdfPageAnalysis(material: MaterialCard, binding: SelectionBinding | null): SelectedPdfAnalysis {
  const selectionKey: string = binding === null ? "" : `${material.id}:${material.file.objectVersion}:${binding.revision}:${binding.selection.originalHash}`;
  const [request, setRequest] = useState<AnalysisRequest | null>(null);
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const requestedPage: number | null = request?.selectionKey === selectionKey ? request.filePage : null;
  const requestKey: string = `${selectionKey}:${request?.selectionKey === selectionKey ? request.generation : 0}`;
  useEffect((): (() => void) => {
    const stop: AbortController = new AbortController();
    if (material.file.kind !== "pdf" || binding === null) return (): void => stop.abort();
    const selectedBinding: SelectionBinding = binding;
    async function analyze(): Promise<void> {
      const handle = await openPdfDocument({ url: material.file.sourceUrl, pages: material.file.pages, signal: stop.signal });
      try {
        const selected: SelectionBinding = requestedPage === null ? selectedBinding : { ...selectedBinding, selection: { ...selectedBinding.selection, pages: selectedBinding.selection.pages.filter((page): boolean => page.filePage === requestedPage) } };
        await analyzeSelectedPdfPages(handle, selected, stop.signal, (page: PdfPageAnalysis): void => {
          if (stop.signal.aborted) return;
          setSnapshot((previous): AnalysisSnapshot => ({ selectionKey, requestKey, complete: false, failure: null, pages: [...(previous?.selectionKey === selectionKey ? previous.pages.filter((entry): boolean => entry.filePage !== page.filePage) : []), page] }));
        });
      } finally { await handle.close(); }
      stop.signal.throwIfAborted();
      setSnapshot((previous): AnalysisSnapshot => ({ selectionKey, requestKey, pages: previous?.selectionKey === selectionKey ? previous.pages : [], complete: true, failure: null }));
    }
    void analyze().catch((error: unknown): void => {
      if (!stop.signal.aborted) setSnapshot((previous): AnalysisSnapshot => ({ selectionKey, requestKey, pages: previous?.selectionKey === selectionKey ? previous.pages : [], complete: true, failure: errorText(error) }));
    });
    return (): void => stop.abort();
  }, [binding, material.file.kind, material.file.pages, material.file.sourceUrl, requestKey, requestedPage, selectionKey]);
  const current: AnalysisSnapshot | null = snapshot?.selectionKey === selectionKey ? snapshot : null;
  function retry(filePage: number): void {
    if (binding === null || !binding.selection.pages.some((page): boolean => page.filePage === filePage)) throw new RangeError("분석을 다시 시도할 선택 페이지가 없어요.");
    setRequest((previous): AnalysisRequest => ({ selectionKey, filePage, generation: (previous?.generation ?? 0) + 1 }));
  }
  return { pages: current?.pages ?? [], analyzing: material.file.kind === "pdf" && binding !== null && (current?.requestKey !== requestKey || !current.complete), failure: current?.failure ?? null, retry };
}
