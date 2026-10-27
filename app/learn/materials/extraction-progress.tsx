import type { ReactElement } from "react";
import type { SelectionInput } from "@/lib/extraction/selection";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import "./extraction.css";

type ExtractionPhase = "select" | "extract" | "compare" | "resolve" | "confirm";
export type ExtractionProgressState = Readonly<{ phase: ExtractionPhase; selectedPages: number; extractedPages: number; confirmedSegments: number; unconfirmedSegments: number; needsResolutionPages: number; outcomeUnknownPages: number; confirmed: boolean }>;

/** 서버에 저장된 현재 결과·확인 구간만 집계하며 화면 열람을 사용자 대조로 간주하지 않습니다. */
export function extractionProgress(selection: SelectionInput | null, pages: readonly StoredExtractionPage[]): ExtractionProgressState {
  const selected: readonly StoredExtractionPage[] = selection === null ? [] : pages.filter((page): boolean => selection.pages.some((entry): boolean => entry.filePage === page.filePage));
  const complete: readonly StoredExtractionPage[] = selected.filter((page): boolean => page.state === "complete" && page.result !== null);
  const confirmedSegments: number = complete.reduce((sum, page): number => sum + (page.result?.status === "complete" ? page.result.segments.filter((segment): boolean => page.confirmedSegmentIds.includes(segment.id) && segment.kind !== "unreadable" && segment.text.trim() !== "").length : 0), 0);
  const unconfirmedSegments: number = complete.reduce((sum, page): number => sum + (page.result?.segments.filter((segment): boolean => !page.confirmedSegmentIds.includes(segment.id) || segment.kind === "unreadable" || segment.text.trim() === "").length ?? 0), 0);
  const needsResolutionPages: number = complete.filter((page): boolean => page.result?.status !== "complete" || page.result.segments.some((segment): boolean => !page.confirmedSegmentIds.includes(segment.id) && (segment.uncertain || segment.kind === "unreadable" || segment.text.trim() === ""))).length;
  const selectedPages: number = selection?.pages.length ?? 0;
  const outcomeUnknownPages: number = selected.filter((page): boolean => page.state === "running" || page.state === "unknown").length;
  const confirmed: boolean = selectedPages > 0 && complete.length === selectedPages && confirmedSegments > 0 && unconfirmedSegments === 0 && needsResolutionPages === 0;
  const phase: ExtractionPhase = selectedPages === 0 ? "select" : complete.length < selectedPages ? "extract" : confirmed ? "confirm" : needsResolutionPages > 0 ? "resolve" : "compare";
  return { phase, selectedPages, extractedPages: complete.length, confirmedSegments, unconfirmedSegments, needsResolutionPages, outcomeUnknownPages, confirmed };
}

const steps: readonly Readonly<{ id: ExtractionPhase; label: string }>[] = [{ id: "select", label: "쪽 선택" }, { id: "extract", label: "추출" }, { id: "compare", label: "원문 비교" }, { id: "resolve", label: "미확인 해결" }, { id: "confirm", label: "확인 저장" }];

export function ExtractionProgress({ selection, pages, busy }: Readonly<{ selection: SelectionInput | null; pages: readonly StoredExtractionPage[]; busy: boolean }>): ReactElement {
  const state: ExtractionProgressState = extractionProgress(selection, pages);
  const labels: Readonly<Record<ExtractionPhase, string>> = {
    select: state.selectedPages === 0 ? "범위를 선택해 주세요" : `${state.selectedPages}쪽 선택됨`,
    extract: state.selectedPages === 0 ? "선택 후 진행" : `${state.extractedPages}/${state.selectedPages}쪽 결과 저장됨`,
    compare: state.confirmedSegments === 0 ? "사용자가 직접 대조" : `${state.confirmedSegments}구간 대조 저장됨`,
    resolve: state.needsResolutionPages > 0 ? `${state.needsResolutionPages}쪽 확인 필요` : state.unconfirmedSegments > 0 ? `${state.unconfirmedSegments}구간 미확인` : state.confirmed ? "현재 구간 확인됨" : "추출 후 확인",
    confirm: state.confirmed ? "확인 저장됨" : "자동 확정하지 않아요",
  };
  return <section className="alter-extraction-progress" aria-label="추출과 확인 단계" aria-busy={busy}>
    <h4 className="alter-label">원본에서 확인된 내용까지</h4>
    <ol>{steps.map((step, index): ReactElement => <li key={step.id} aria-current={state.phase === step.id ? "step" : undefined}><span className="alter-step-number" aria-hidden="true">{index + 1}</span><div><strong>{step.label}</strong><span className="alter-caption">{labels[step.id]}</span></div></li>)}</ol>
    <p className="alter-caption">{busy ? "현재 요청을 처리하고 있어요. 저장 응답을 확인하기 전에는 완료로 표시하지 않아요." : state.outcomeUnknownPages > 0 ? `결과 확인이 필요한 ${state.outcomeUnknownPages}쪽은 기존 요청부터 확인해 주세요. 새 AI 판독은 자동 실행하지 않아요.` : "원문 비교와 미확인 해결은 함께 진행해요. 확인 저장 후에도 서지정보·학습 출처 검토는 별도예요."}</p>
  </section>;
}
