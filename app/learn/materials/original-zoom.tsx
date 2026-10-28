"use client";

import { useId, type ReactElement } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";

type OriginalZoomProps = Readonly<{ label: string; zoom: number; maximum: number; onZoom: (zoom: number) => void }>;

/** 원본 종류와 무관하게 같은 확대 조작과 키보드 범위를 제공합니다. */
export function OriginalZoom({ label, zoom, maximum, onZoom }: OriginalZoomProps): ReactElement {
  const id: string = useId();
  return <div className="alter-original-zoom" role="group" aria-label={label}>
    <label className="alter-original-zoom-label" htmlFor={id}>{label}</label>
    <div className="alter-original-zoom-controls">
      <button type="button" aria-label="원본 축소" disabled={zoom <= 100} onClick={(): void => onZoom(Math.max(100, zoom - 25))}><Minus aria-hidden="true" /></button>
      <input id={id} type="range" min={100} max={maximum} step={25} value={zoom} onChange={(event): void => onZoom(Number(event.target.value))} />
      <button type="button" aria-label="원본 확대 한 단계" disabled={zoom >= maximum} onClick={(): void => onZoom(Math.min(maximum, zoom + 25))}><Plus aria-hidden="true" /></button>
      <button type="button" className="alter-original-reset" aria-label={`${zoom}% · 크기 초기화`} title="기본 크기로 돌아가기" onClick={(): void => onZoom(100)}><output htmlFor={id}>{zoom}%</output><RotateCcw aria-hidden="true" /></button>
    </div>
  </div>;
}
