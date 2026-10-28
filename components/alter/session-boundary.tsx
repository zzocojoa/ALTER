"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";

const ownerSession = z.object({ authenticated: z.literal(true), role: z.literal("owner") });

/** 복귀 시 본문을 유지한 채 가리고 서버 소유자 판정이 성공한 최신 요청만 다시 표시합니다. */
export function SessionBoundary({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const [covered, setCovered] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const hidden = useRef<boolean>(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef<number>(0);
  const recheck = useCallback(async (): Promise<void> => {
    active.current?.abort();
    const controller: AbortController = new AbortController();
    active.current = controller;
    const requestGeneration: number = ++generation.current;
    hidden.current = true;
    setCovered(true); setChecking(true); setError("");
    try {
      const response: Response = await fetch("/api/session", { method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`접근 상태 확인 실패 (GET /api/session, HTTP ${response.status}). 로그인과 소유자 권한을 확인해 주세요.`);
      ownerSession.parse(await response.json());
      if (controller.signal.aborted || requestGeneration !== generation.current || document.visibilityState === "hidden") return;
      hidden.current = false;
      setCovered(false);
    } catch (cause: unknown) {
      if (controller.signal.aborted || requestGeneration !== generation.current) return;
      if (!(cause instanceof Error)) throw cause;
      setError("학습 화면을 가렸어요. " + cause.message);
    } finally {
      if (requestGeneration === generation.current) { active.current = null; setChecking(false); }
    }
  }, []);
  useEffect((): (() => void) => {
    function conceal(): void {
      generation.current += 1;
      active.current?.abort(); active.current = null;
      hidden.current = true;
      // 브라우저가 화면을 보관하기 전에 숨김을 동기 반영합니다.
      flushSync((): void => { setCovered(true); setChecking(false); setError(""); });
    }
    function show(event: PageTransitionEvent): void { if (event.persisted || hidden.current) void recheck(); }
    function visibility(): void { if (document.visibilityState === "hidden") conceal(); else if (hidden.current) void recheck(); }
    window.addEventListener("pagehide", conceal);
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", visibility);
    return (): void => {
      generation.current += 1; active.current?.abort();
      window.removeEventListener("pagehide", conceal); window.removeEventListener("pageshow", show); document.removeEventListener("visibilitychange", visibility);
    };
  }, [recheck]);
  return <div data-alter-ui>
    <div className="alter-session-content" hidden={covered} inert={covered}>{children}</div>
    {covered ? <main className="site-shell alter-state" aria-label="학습 접근 재확인"><h1 className="alter-heading">학습 접근을 다시 확인해요</h1><p role="status">{checking ? "소유자 권한과 복원 상태를 확인하고 있어요." : "확인이 끝나면 작성하던 화면으로 돌아가요."}</p>{error === "" ? null : <p role="alert">{error}</p>}<button type="button" className="alter-control" disabled={checking} onClick={(): void => { void recheck(); }}>접근 상태 다시 확인</button>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 인증 재진입은 서버 판정을 다시 받는 전체 문서 이동입니다. */}
      <a className="alter-link" href="/" target="_top">로그인 화면으로</a></main> : null}
  </div>;
}
