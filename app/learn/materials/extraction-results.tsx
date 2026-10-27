"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { MaterialCard } from "@/lib/materials/library";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import { OriginalComparison } from "./original-comparison";
import type { ComparisonPane } from "./original-comparison";
import { originalSegmentLocation } from "./segment-location";
import type { OriginalHighlight, SegmentLocation } from "./segment-location";
import { SelectedOriginal } from "./selected-original";
import { ResultEditor } from "./result-editor";
import { emptyResultDraft } from "./result-draft";
import type { ResultDraft } from "./result-draft";

type SegmentFocus = Readonly<{ pageId: string; resultId: string | null; segmentId: string }>;

export function ExtractionResults({ material, pages, onSaved }: Readonly<{ material: MaterialCard; pages: readonly StoredExtractionPage[]; onSaved: (page: StoredExtractionPage) => void }>): ReactElement | null {
  const [drafts, setDrafts] = useState<Readonly<Record<string, ResultDraft>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pane, setPane] = useState<ComparisonPane>("result");
  const [segmentFocus, setSegmentFocus] = useState<SegmentFocus | null>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const page: StoredExtractionPage | undefined = pages.find((item): boolean => item.id === selectedId) ?? pages[0];
  useEffect((): void => {
    if (segmentFocus === null) return;
    sourceRef.current?.focus({ preventScroll: true });
    sourceRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [segmentFocus]);
  if (page === undefined) return null;
  const draftKey: string = `${page.id}:${page.selectionRevision}`;
  const segment = segmentFocus?.pageId === page.id && segmentFocus.resultId === page.resultId ? page.result?.segments.find((item): boolean => item.id === segmentFocus.segmentId) : undefined;
  const location: SegmentLocation | null = segment === undefined ? null : originalSegmentLocation(page, segment);
  const highlight: OriginalHighlight | null = location?.kind === "located" && segment !== undefined ? { bounds: location.bounds, label: `구간 ${(page.result?.segments.indexOf(segment) ?? -1) + 1}`, uncertain: segment.uncertain && !page.confirmedSegmentIds.includes(segment.id) } : null;
  function updateDraft(update: (current: ResultDraft) => ResultDraft): void {
    setDrafts((current): Readonly<Record<string, ResultDraft>> => ({ ...current, [draftKey]: update(current[draftKey] ?? emptyResultDraft) }));
  }
  function locate(segmentId: string): void {
    if (page === undefined) return;
    setSegmentFocus({ pageId: page.id, resultId: page.resultId, segmentId }); setPane("source");
  }
  return <section className="extraction-review" aria-label="원본과 결과 비교">
    <aside className="alter-extraction-metadata" aria-label="등록 정보와 서지 확인"><h4>등록 정보 · 서지 확인</h4><p>{material.metadata.title} · 등록한 판본: {material.metadata.edition || "미입력"}</p><p>등록 정보는 추출한 본문이 아니에요. 저자·출판사·판본의 근거는 <a href="/learn/library">학습 범위의 자료 연결</a>에서 따로 확인합니다.</p></aside>
    <h3>원본과 나란히 확인</h3><p className="alter-caption">구간 위치를 열어 표·수식·그림 주변을 원본과 대조하세요. 그림 자체는 원본에서 확인하며 추출 문장으로 대신하지 않아요.</p><nav className="material-toolbar" aria-label="비교할 파일 페이지">{pages.map((item): ReactElement => <button type="button" key={item.id} aria-pressed={page.id === item.id} onClick={(): void => { setSelectedId(item.id); }}>파일 {item.filePage}페이지 결과{item.state === "failed" ? " · 실패" : item.state === "pending" ? " · 대기" : item.state === "unknown" ? " · 확인 필요" : ""}</button>)}</nav>
    <OriginalComparison pane={pane} onPaneChange={setPane} source={<div ref={sourceRef} tabIndex={-1} role="region" aria-label={`파일 ${page.filePage}페이지 구간 대조`}>
      {location?.kind === "unavailable" && <p role="status">{location.reason}</p>}
      <SelectedOriginal material={material} filePage={page.filePage} printedPage={page.printedPage} highlight={highlight} />
    </div>} result={<ResultEditor key={draftKey} materialId={material.id} page={page} draft={drafts[draftKey] ?? emptyResultDraft} onDraft={updateDraft} onSaved={onSaved} onLocate={locate} />} />
  </section>;
}
