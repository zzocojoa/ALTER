"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import { useLocationFragment } from "@/lib/use-location-fragment";
import "./diagnostics.css";

/** 각 소유자 페이지의 검사와 상태를 보존하고 딥링크에서만 검사 영역을 펼칩니다. */
export function ContextDiagnostics({ id, title, children }: Readonly<{ id: string; title: string; children: ReactNode }>): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const fragment: string = useLocationFragment(); const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (fragment === `#${id}` && details.current) { details.current.open = true; details.current.focus(); details.current.scrollIntoView({ block: "start" }); } }, [fragment, id]);
  return <details ref={details} id={id} tabIndex={-1} className="context-diagnostics" inert={!ready}><summary>고급 · 소유자 진단 — {title}</summary><p className="alter-caption">학습 답안 작성과 별도인 기능 검사예요. 여기를 펼쳐도 검사나 AI·Google 전송은 실행하지 않아요.</p>{children}<a className="alter-link" href="/learn/diagnostics">소유자 진단 목록으로</a></details>;
}
