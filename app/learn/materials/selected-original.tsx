"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { MaterialCard } from "@/lib/materials/library";
import { openPdfDocument } from "./pdf-document";
import type { PdfDocumentHandle } from "./pdf-document";
import { renderPdfOriginal } from "./render-pdf-original";
import { ImagePreview, TextPreview } from "./original-media";
import { OriginalDialog } from "./original-dialog";
import { errorText } from "./client-api";

export function PdfPageOriginal({ url, pages, filePage }: Readonly<{ url: string; pages: number; filePage: number }>): ReactElement {
  const [zoom, setZoom] = useState<number>(100);
  const canvas = useRef<HTMLCanvasElement>(null); const [ready, setReady] = useState<boolean>(false); const [failure, setFailure] = useState<string>("");
  useEffect((): (() => void) => {
    const stop: AbortController = new AbortController(); let handle: PdfDocumentHandle | null = null; const element: HTMLCanvasElement | null = canvas.current;
    async function open(): Promise<void> { handle = await openPdfDocument({ url, pages, signal: stop.signal }); if (element === null) throw new Error("원본 대조 캔버스가 없어요."); await renderPdfOriginal(handle, filePage, element, stop.signal); if (!stop.signal.aborted) setReady(true); }
    void open().catch((error: unknown): void => { if (!stop.signal.aborted) setFailure(errorText(error)); });
    return (): void => { stop.abort(); if (element !== null) { element.width = 0; element.height = 0; } if (handle !== null) void handle.close().catch((error: unknown): void => { console.warn({ event: "comparison_pdf_cleanup_failed", errorType: error instanceof Error ? error.name : "unknown" }); }); };
  }, [url, pages, filePage]);
  return <div>{failure ? <p role="alert">{failure}</p> : <><p role="status">{ready ? `파일 ${filePage}페이지 원본` : "원본을 준비하고 있어요…"}</p><label>대조 원본 확대 <input type="range" min={100} max={200} step={25} value={zoom} onChange={(event): void => { setZoom(Number(event.target.value)); }} /> {zoom}%</label><div className="extraction-pdf-scroll" hidden={!ready} tabIndex={0} role="region" aria-label="대조 원본 이동 영역"><canvas ref={canvas} style={{ width: `${zoom}%`, maxWidth: "none", height: "auto" }} aria-label={`대조 원본 ${filePage}페이지`} /></div></>}</div>;
}
export function SelectedOriginal({ material, filePage }: Readonly<{ material: MaterialCard; filePage: number }>): ReactElement {
  const content = material.file.kind === "pdf" ? <PdfPageOriginal key={`${material.id}:${filePage}`} url={material.file.sourceUrl} pages={material.file.pages} filePage={filePage} /> : material.file.kind === "image" ? <ImagePreview material={material} /> : <TextPreview url={material.file.sourceUrl} />;
  return <><OriginalDialog label={`파일 ${filePage}페이지 원본`} url={material.file.sourceUrl}>{content}</OriginalDialog>{content}</>;
}
