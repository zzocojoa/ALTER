"use client";

import { useId, useState, type ReactElement } from "react";
import { ActionButton } from "@/components/alter/action-button";
import { OriginalZoom } from "./original-zoom";
import "./original.css";

export type OriginalPageLabel = Readonly<{ filePage: number; printedPage: string | null }>;
type OriginalToolbarProps = Readonly<{ filePage: number; pages: number; printedPage: string | null; zoom: number; zoomLabel: string; onZoom: (zoom: number) => void; onPage: ((page: number) => void) | null }>;

export function parseOriginalPage(value: string, pages: number): number {
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > pages) throw new RangeError(`파일 페이지는 1부터 ${pages}까지의 정수로 입력해 주세요.`);
  return Number(value);
}

/** 파일 위치와 저장된 인쇄 쪽수를 구분하며 잘못된 입력으로 기존 원본을 바꾸지 않습니다. */
export function OriginalToolbar({ filePage, pages, printedPage, zoom, zoomLabel, onZoom, onPage }: OriginalToolbarProps): ReactElement {
  const id: string = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  function changePage(value: string): void {
    setDraft(value);
    try { const next: number = parseOriginalPage(value, pages); setFailure(null); onPage?.(next); }
    catch (error: unknown) { if (!(error instanceof RangeError)) throw error; setFailure(error.message); }
  }
  function movePage(page: number): void { setDraft(null); setFailure(null); onPage?.(page); }
  return <div className="alter-original-toolbar" role="group" aria-label="원본 페이지와 확대">
    {onPage === null ? <p className="alter-label">파일 {filePage} / {pages}페이지</p> : <div className="alter-original-pagination">
      <ActionButton id={id + "-previous"} type="button" tone="secondary" availability={filePage <= 1 ? { kind: "blocked", reason: "첫 페이지예요." } : { kind: "available" }} onClick={(): void => movePage(filePage - 1)}>이전 페이지</ActionButton>
      <label className="alter-label" htmlFor={id + "-page"}>파일 페이지<input className="alter-control alter-input" id={id + "-page"} type="text" inputMode="numeric" value={draft ?? String(filePage)} aria-invalid={failure !== null} aria-describedby={id + "-page-help"} onChange={(event): void => changePage(event.target.value)} /></label>
      <span className="alter-caption">/ {pages}</span>
      <ActionButton id={id + "-next"} type="button" tone="secondary" availability={filePage >= pages ? { kind: "blocked", reason: "마지막 페이지예요." } : { kind: "available" }} onClick={(): void => movePage(filePage + 1)}>다음 페이지</ActionButton>
      <p id={id + "-page-help"} className="alter-caption" role={failure === null ? undefined : "alert"}>{failure ?? `현재 원본: 파일 ${filePage}페이지`}</p>
    </div>}
    <p className="alter-caption">인쇄 쪽수: <strong>{printedPage ?? "미확인"}</strong> · 파일 페이지와 별도예요.</p>
    <OriginalZoom label={zoomLabel} zoom={zoom} maximum={200} onZoom={onZoom} />
  </div>;
}
