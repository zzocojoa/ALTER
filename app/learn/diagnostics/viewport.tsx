"use client";
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import "./diagnostics.css";

function subscribeToViewport(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return (): void => { window.removeEventListener("resize", onChange); };
}

function readViewport(): string {
  const viewport: HTMLElement = document.documentElement;
  return `폭 ${viewport.clientWidth} · 높이 ${viewport.clientHeight} CSS px`;
}

function serverViewport(): string {
  return "브라우저에서 화면 크기를 확인하고 있어요.";
}

/** 분할 화면과 회전 후 실제 레이아웃 크기를 브라우저 안에서만 읽습니다. */
export function ViewportDiagnostics(): ReactElement {
  const dimensions: string = useSyncExternalStore(subscribeToViewport, readViewport, serverViewport);
  return <section id="diagnostic-viewport" className="viewport-diagnostics" aria-labelledby="viewport-title">
    <h2 id="viewport-title" className="alter-subheading">현재 화면 크기</h2>
    <p className="viewport-dimensions">{dimensions}</p>
    <p className="alter-caption">Safari 창의 폭을 바꾸거나 기기를 돌리면 값이 바뀌어요. 화면 배치에 사용하는 크기이며, 기기 해상도와는 달라요. 이 값은 서버에 저장하거나 전송하지 않아요.</p>
  </section>;
}
