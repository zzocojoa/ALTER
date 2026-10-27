"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { MaterialCard } from "@/lib/materials/library";
import { openPdfDocument } from "./pdf-document";
import type { PdfDocumentHandle } from "./pdf-document";
import { renderPdfOriginal } from "./render-pdf-original";
import { ImagePreview, TextPreview } from "./original-media";
import { OriginalDialog } from "./original-dialog";
import { OriginalToolbar } from "./original-toolbar";
import { OriginalHighlightBox } from "./original-highlight";
import type { OriginalHighlight } from "./segment-location";
import { OriginalFailure, originalErrorText, originalFailure } from "./original-failure";

type PdfPageOriginalProps = Readonly<{ url: string; pages: number; filePage: number; printedPage: string | null; initialZoom: number; highlight: OriginalHighlight | null }>;
export function PdfPageOriginal(props: PdfPageOriginalProps): ReactElement {
  return <PdfPageSession key={`${props.url}:${props.pages}:${props.filePage}`} {...props} />;
}

function PdfPageSession({ url, pages, filePage, printedPage, initialZoom, highlight }: PdfPageOriginalProps): ReactElement {
  const [zoom, setZoom] = useState<number>(initialZoom);
  const canvas = useRef<HTMLCanvasElement>(null); const [ready, setReady] = useState<boolean>(false); const [failure, setFailure] = useState<string>("");
  useEffect((): (() => void) => {
    const stop: AbortController = new AbortController(); let handle: PdfDocumentHandle | null = null; const element: HTMLCanvasElement | null = canvas.current;
    async function open(): Promise<void> { handle = await openPdfDocument({ url, pages, signal: stop.signal }); if (element === null) throw originalFailure("원본 대조 캔버스가 없어요."); await renderPdfOriginal(handle, filePage, element, stop.signal); if (!stop.signal.aborted) setReady(true); }
    void open().catch((error: unknown): void => { if (!stop.signal.aborted) setFailure(originalErrorText(error)); });
    return (): void => { stop.abort(); if (element !== null) { element.width = 0; element.height = 0; } if (handle !== null) void handle.close().catch((error: unknown): void => { console.warn({ event: "comparison_pdf_cleanup_failed", errorType: error instanceof Error ? error.name : "unknown" }); }); };
  }, [url, pages, filePage]);
  return <div>{failure ? <OriginalFailure filePage={filePage} detail={failure} /> : <><p role="status">{ready ? `파일 ${filePage}페이지 원본` : "원본을 준비하고 있어요…"}</p><OriginalToolbar filePage={filePage} pages={pages} printedPage={printedPage} zoom={zoom} zoomLabel="대조 원본 확대" onZoom={setZoom} onPage={null} /><div className="extraction-pdf-scroll" hidden={!ready} tabIndex={0} role="region" aria-label="대조 원본 이동 영역"><div className="alter-original-surface" style={{ width: `${zoom}%` }}><canvas ref={canvas} style={{ width: "100%", height: "auto" }} aria-label={`대조 원본 ${filePage}페이지`} /><OriginalHighlightBox highlight={highlight} /></div></div></>}</div>;
}
export function SelectedOriginal({ material, filePage, printedPage, highlight }: Readonly<{ material: MaterialCard; filePage: number; printedPage: string | null; highlight: OriginalHighlight | null }>): ReactElement {
  const content = material.file.kind === "pdf" ? <PdfPageOriginal key={`${material.id}:${filePage}`} url={material.file.sourceUrl} pages={material.file.pages} filePage={filePage} printedPage={printedPage} initialZoom={100} highlight={highlight} /> : material.file.kind === "image" ? <ImagePreview material={material} highlight={highlight} /> : <TextPreview url={material.file.sourceUrl} />;
  return <>{highlight !== null && <p className="alter-caption" role="status">{highlight.label} 위치를 테두리로 표시했어요. {highlight.uncertain ? "미확인 구간이므로 원본과 직접 대조해 주세요." : "위치 표시는 내용 확정을 뜻하지 않아요."}</p>}<OriginalDialog label={`파일 ${filePage}페이지 원본`} url={material.file.sourceUrl}>{content}</OriginalDialog>{content}</>;
}
