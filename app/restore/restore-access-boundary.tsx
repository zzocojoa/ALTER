"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { flushSync } from "react-dom";
import { AccessScreen } from "@/components/alter/access-screen";

/** 격리 관리자는 일반 학습 세션 API를 쓰지 않고 문서 재요청으로 소유자를 다시 확인합니다. */
export function RestoreAccessBoundary({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const [covered, setCovered] = useState<boolean>(false); const hidden = useRef<boolean>(false);
  useEffect(() => {
    function conceal(): void { hidden.current = true; flushSync(() => setCovered(true)); }
    function show(event: PageTransitionEvent): void { if (event.persisted || hidden.current) { conceal(); window.location.reload(); } }
    function visibility(): void { if (document.visibilityState === "hidden") conceal(); else if (hidden.current) { conceal(); window.location.reload(); } }
    if (document.visibilityState === "hidden") hidden.current = true;
    window.addEventListener("pagehide", conceal); window.addEventListener("pageshow", show); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("pagehide", conceal); window.removeEventListener("pageshow", show); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return <div data-alter-ui><div hidden={covered} inert={covered}>{children}</div>{covered && <AccessScreen title="복원 관리자 접근을 다시 확인해요" context="소유자 확인 중" detail="돌아오면 소유자 권한을 다시 확인해요. 이어갈 때 같은 복원 ID와 파일을 선택해 주세요."><a className="alter-link" href="/restore">복원 관리자 다시 열기</a></AccessScreen>}</div>;
}
