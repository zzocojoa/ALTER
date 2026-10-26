"use client";

import { CheckTarget } from "../check-target";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { OriginalDialog } from "./original-dialog";
import { PdfPageOriginal } from "./selected-original";
import { renderPdfOriginal } from "./render-pdf-original";
import { errorText } from "./client-api";
import { openPdfDocument } from "./pdf-document";
import type { PdfDocumentHandle } from "./pdf-document";

type PdfPreviewProps = Readonly<{ url: string; pages: number; title: string }>;

/** 실제 Web Worker로 현재 페이지만 준비하고 페이지 이동 전 서버의 가림 상태를 재확인합니다. */
export function PdfPreview({ url, pages, title }: PdfPreviewProps): ReactElement {
  const [document, setDocument] = useState<PdfDocumentHandle | null>(null);
  const [page, setPage] = useState<number>(1);
  const [text, setText] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [rendered, setRendered] = useState<number>(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect((): (() => void) => {
    const stop: AbortController = new AbortController();
    let opened: PdfDocumentHandle | null = null;
    async function open(): Promise<void> {
      opened = await openPdfDocument({ url, pages, signal: stop.signal });
      if (!stop.signal.aborted) setDocument(opened);
      else await opened.close();
    }
    void open().catch((failure: unknown): void => { if (!stop.signal.aborted) setError(errorText(failure)); });
    return (): void => { stop.abort(); if (opened !== null) void opened.close().catch((failure: unknown): void => { console.warn({ event: "pdf_preview_cleanup_failed", errorType: failure instanceof Error ? failure.name : "unknown" }); }); };
  }, [url, pages]);
  useEffect((): (() => void) => {
    const stop: AbortController = new AbortController();
    async function render(): Promise<void> {
      if (document === null || canvas.current === null) return;
      const visible: string = await renderPdfOriginal(document, page, canvas.current, stop.signal);
      if (!stop.signal.aborted) { setText(visible); setRendered(page); }
    }
    void render().catch((failure: unknown): void => { if (!stop.signal.aborted) setError(errorText(failure)); });
    return (): void => { stop.abort(); };
  }, [document, page, url]);
  if (error) return <p role="alert">{error}</p>;
  return <section aria-label="PDF 원본"><CheckTarget id="check-original" instruction={`③ 아래 ‘파일 ${page}페이지 원본 크게 보기’를 누른 뒤 휴대폰을 가로로 돌려 보고, ‘확대 화면 닫기’를 눌러 주세요.`}><div className="material-toolbar"><button type="button" disabled={page <= 1} onClick={(): void => { setRendered(0); setPage(page - 1); }}>이전 페이지</button><label>파일 페이지 <input type="number" aria-label="파일 페이지" min={1} max={pages} value={page} onChange={(event): void => { const next: number = Number(event.target.value); if (Number.isInteger(next) && next >= 1 && next <= pages) { setRendered(0); setPage(next); } }} /></label><span>/ {pages}</span><button type="button" disabled={page >= pages} onClick={(): void => { setRendered(0); setPage(page + 1); }}>다음 페이지</button></div><OriginalDialog label={`파일 ${page}페이지 원본`} url={url}><PdfPageOriginal url={url} pages={pages} filePage={page}/></OriginalDialog></CheckTarget><p className="material-note">파일 페이지 번호예요. 책에 인쇄된 쪽수와 다를 수 있어요.</p><p role="status">{rendered === page ? `${page}페이지를 열었어요.` : "페이지를 준비하고 있어요…"}</p><div className="material-canvas" hidden={rendered !== page}><canvas ref={canvas} aria-label={`${title}, ${page}페이지`} /></div><details><summary>이 페이지의 텍스트</summary><pre className="material-text">{rendered === page ? text || "추출된 텍스트가 없어요. 스캔 페이지는 원본 이미지로 확인해 주세요." : "페이지 준비 중"}</pre></details></section>;
}
