"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";

/** 뒤로가기 캐시의 원문은 서버에서 같은 출처의 유효성과 인출 가림을 다시 확인한 뒤 표시합니다. */
export function SourceAccess({ sourceId, children }: Readonly<{ sourceId: string; children: ReactNode }>): ReactElement {
  const [visible, setVisible] = useState<boolean>(true); const [error, setError] = useState<string>("");
  const request = useRef<AbortController | null>(null);
  const restore = useCallback(async (): Promise<void> => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setVisible(false); setError("");
    try {
      const response = await fetch(`/api/librarian/sources/${sourceId}/visibility`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`원문 접근을 다시 확인하지 못했어요 (HTTP ${response.status}). 로그인·인출 상태 또는 정정된 출처를 확인해 주세요.`);
      if (!controller.signal.aborted) setVisible(true);
    } catch (cause: unknown) { if (controller.signal.aborted) return; if (!(cause instanceof Error)) throw cause; setError(cause.message); }
  }, [sourceId]);
  useEffect(() => {
    function hide(): void { request.current?.abort(); setVisible(false); }
    function show(): void { if (document.visibilityState === "visible") void restore(); }
    function visibility(): void { if (document.visibilityState === "hidden") hide(); else show(); }
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener(RECALL_START_EVENT, hide); document.addEventListener("visibilitychange", visibility);
    return () => { request.current?.abort(); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener(RECALL_START_EVENT, hide); document.removeEventListener("visibilitychange", visibility); };
  }, [restore]);
  return visible ? <>{children}</> : <section><p role="status">원문을 가리고 접근 상태를 다시 확인해요.</p>{error && <p role="alert">{error}</p>}<button onClick={() => void restore()}>원문 접근 다시 확인</button><p><a href="/learn">오늘의 학습 현황</a></p></section>;
}
