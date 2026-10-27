"use client";
/* eslint-disable @next/next/no-img-element -- 인증된 원본의 로컬 객체 URL을 표시합니다. */
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { MaterialCard } from "@/lib/materials/library";
import { requireMaterialResponse } from "./client-api";
import { OriginalFailure, originalErrorText, originalFailure } from "./original-failure";
import { OriginalHighlightBox } from "./original-highlight";
import type { OriginalHighlight } from "./segment-location";
type SourcePreviewProps = Readonly<{ material: MaterialCard; highlight: OriginalHighlight | null }>;
export function TextPreview({ url }: Readonly<{ url: string }>): ReactElement {
  return <TextSource key={url} url={url} />;
}
function TextSource({ url }: Readonly<{ url: string }>): ReactElement {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  useEffect((): (() => void) => {
    const stop: AbortController = new AbortController();
    async function load(): Promise<void> { const response: Response = await fetch(url, { cache: "no-store", signal: stop.signal }); await requireMaterialResponse(response); const value: string = await response.text(); if (!stop.signal.aborted) setText(value); }
    void load().catch((failure: unknown): void => { if (!stop.signal.aborted) setError(originalErrorText(failure)); });
    return (): void => { stop.abort(); };
  }, [url]);
  if (error) return <OriginalFailure filePage={1} detail={error} />;
  return text === null ? <p role="status">텍스트를 불러오고 있어요…</p> : <pre className="material-text" tabIndex={0} aria-label="텍스트 원본">{text}</pre>;
}
export function ImagePreview({ material, highlight }: SourcePreviewProps): ReactElement {
  return <ImageSource key={`${material.file.sourceUrl}:${material.file.objectVersion}`} material={material} highlight={highlight} />;
}
function ImageSource({ material, highlight }: SourcePreviewProps): ReactElement {
  const [source, setSource] = useState<string>("");
  const [zoom, setZoom] = useState<number>(100);
  const [error, setError] = useState<string>("");
  useEffect((): (() => void) => {
    const stop: AbortController = new AbortController();
    let blobUrl: string | null = null;
    async function load(): Promise<void> {
      const response: Response = await fetch(material.file.sourceUrl, { cache: "no-store", signal: stop.signal }); await requireMaterialResponse(response);
      const blob: Blob = await response.blob();
      if (blob.size !== material.file.bytes) throw originalFailure("받은 사진 크기가 원본과 달라요.");
      if (!stop.signal.aborted) { blobUrl = URL.createObjectURL(blob); setSource(blobUrl); }
    }
    void load().catch((failure: unknown): void => { if (!stop.signal.aborted) setError(originalErrorText(failure)); });
    return (): void => { stop.abort(); if (blobUrl !== null) URL.revokeObjectURL(blobUrl); };
  }, [material]);
  if (error) return <OriginalFailure filePage={1} detail={error} />;
  return <section aria-label="사진 원본"><div className="material-toolbar"><label>사진 확대 <input type="range" min={100} max={300} step={25} value={zoom} onChange={(event): void => { setZoom(Number(event.target.value)); }} /></label><output>{zoom}%</output><button type="button" onClick={(): void => { setZoom(100); }}>크기 초기화</button></div><p className="material-note">확대한 사진은 스크롤하거나 방향키로 이동할 수 있어요.</p><div className="material-image" tabIndex={0} role="region" aria-label="사진 이동 영역">{source ? <div className="alter-original-surface" style={{ width: `${zoom}%` }}><img src={source} alt={material.metadata.title} style={{ width: "100%", maxWidth: "none" }} onError={(): void => { setError("사진을 표시할 수 없어요. 원본 상태를 확인해 주세요."); }} /><OriginalHighlightBox highlight={highlight} /></div> : <p role="status">사진을 불러오고 있어요…</p>}</div></section>;
}
