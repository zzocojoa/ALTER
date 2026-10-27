"use client";

import { CheckTarget } from "../check-target";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { OriginalToolbar, type OriginalPageLabel } from "./original-toolbar";
import { OriginalDialog } from "./original-dialog";
import { PdfPageOriginal } from "./selected-original";
import { renderPdfOriginal } from "./render-pdf-original";
import { OriginalFailure, originalErrorText } from "./original-failure";
import { openPdfDocument } from "./pdf-document";
import type { PdfDocumentHandle } from "./pdf-document";

type PdfPreviewProps = Readonly<{ url: string; pages: number; title: string; labels: readonly OriginalPageLabel[] }>;

/** 실제 Web Worker로 현재 페이지만 준비하고 페이지 이동 전 서버의 가림 상태를 재확인합니다. */
export function PdfPreview(props: PdfPreviewProps): ReactElement {
  return <PdfPreviewSession key={`${props.url}:${props.pages}`} {...props} />;
}

function PdfPreviewSession({ url, pages, title, labels }: PdfPreviewProps): ReactElement {
  const [document, setDocument] = useState<PdfDocumentHandle | null>(null);
  const [page, setPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(100);
  const printedPage: string | null = labels.find((label): boolean => label.filePage === page)?.printedPage ?? null;
  const [text, setText] = useState<string>("");
  const [documentError, setDocumentError] = useState<string>("");
  const [renderError, setRenderError] = useState<string>("");
  const error: string = documentError || renderError;
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
    void open().catch((failure: unknown): void => { if (!stop.signal.aborted) setDocumentError(originalErrorText(failure)); });
    return (): void => { stop.abort(); if (opened !== null) void opened.close().catch((failure: unknown): void => { console.warn({ event: "pdf_preview_cleanup_failed", errorType: failure instanceof Error ? failure.name : "unknown" }); }); };
  }, [url, pages]);
  useEffect((): (() => void) => {
    const stop: AbortController = new AbortController();
    const element: HTMLCanvasElement | null = canvas.current;
    async function render(): Promise<void> {
      if (document === null || element === null) return;
      const visible: string = await renderPdfOriginal(document, page, element, stop.signal);
      if (!stop.signal.aborted) { setText(visible); setRendered(page); }
    }
    void render().catch((failure: unknown): void => { if (!stop.signal.aborted) setRenderError(originalErrorText(failure)); });
    return (): void => { stop.abort(); if (element !== null) { element.width = 0; element.height = 0; } };
  }, [document, page, url]);
  return <section aria-label="PDF 원본"><CheckTarget id="check-original" instruction={`③ 아래 ‘파일 ${page}페이지 원본 크게 보기’를 누른 뒤 휴대폰을 가로로 돌려 보고, ‘확대 화면 닫기’를 눌러 주세요.`}><OriginalToolbar filePage={page} pages={pages} printedPage={printedPage} zoom={zoom} zoomLabel="원본 확대" onZoom={setZoom} onPage={(next: number): void => { if (next !== page) { setRendered(0); setRenderError(""); setPage(next); } }} /><OriginalDialog label={`파일 ${page}페이지 원본`} url={url}><PdfPageOriginal url={url} pages={pages} filePage={page} printedPage={printedPage} initialZoom={zoom} highlight={null} /></OriginalDialog></CheckTarget><p className="material-note">파일 페이지 번호예요. 책에 인쇄된 쪽수와 다를 수 있어요.</p>{error ? <OriginalFailure filePage={page} detail={error} /> : <><p role="status">{rendered === page ? `${page}페이지를 열었어요.` : "페이지를 준비하고 있어요…"}</p><div className="material-canvas" hidden={rendered !== page} tabIndex={0} role="region" aria-label="PDF 원본 이동 영역"><canvas key={page} ref={canvas} style={{ width: `${zoom}%`, maxWidth: "none", height: "auto" }} aria-label={`${title}, ${page}페이지`} /></div><details><summary>이 페이지의 텍스트</summary><pre className="material-text">{rendered === page ? text || "추출된 텍스트가 없어요. 스캔 페이지는 원본 이미지로 확인해 주세요." : "페이지 준비 중"}</pre></details></>}</section>;
}
