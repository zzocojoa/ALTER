"use client";
import { useEffect, useRef } from "react";

type DraftNavigation = Readonly<{ dirty: boolean; busy: boolean; save: () => Promise<boolean>; onError: (message: string) => void }>;
/** 화면을 떠나는 링크는 초안 저장 성공 후 이동하고 새로고침·뒤로가기는 브라우저 이탈 확인을 사용합니다. */
export function useDraftNavigation({ dirty, busy, save, onError }: DraftNavigation): void {
  const leaving = useRef<boolean>(false);
  const saving = useRef<boolean>(false);
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent): void {
      if (!leaving.current && (dirty || busy || saving.current)) { event.preventDefault(); event.returnValue = ""; }
    }
    function click(event: MouseEvent): void {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || link.target && link.target !== "_self") return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || url.pathname === location.pathname && url.search === location.search) return;
      if (!dirty && !busy && !saving.current) return;
      event.preventDefault(); event.stopPropagation();
      if (busy || saving.current) { onError("저장·사진 전송 결과를 확인한 뒤 이동해 주세요. 입력은 이 화면에 보관돼요."); return; }
      saving.current = true;
      void save().then((ok: boolean): void => { if (ok) { leaving.current = true; window.location.assign(url.href); } }).catch((error: unknown): void => { if (!(error instanceof Error)) throw error; onError(error.message); }).finally((): void => { saving.current = false; });
    }
    function restored(): void { leaving.current = false; }
    window.addEventListener("beforeunload", beforeUnload); document.addEventListener("click", click, true); window.addEventListener("pageshow", restored);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); window.removeEventListener("pageshow", restored); };
  }, [dirty, busy, save, onError]);
}
