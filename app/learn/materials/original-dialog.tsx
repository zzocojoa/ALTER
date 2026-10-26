"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";

type OriginalDialogProps = Readonly<{ label: string; url: string; children: ReactNode }>;
/** 확대 직전에 서버 접근 권한을 재확인하며 닫기·인출 시작·화면 이탈 시 원문을 해제합니다. */
export function OriginalDialog({ label, url, children }: OriginalDialogProps): ReactElement {
  const title = useId(); const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<AbortController | null>(null);
  const [opened, setOpened] = useState<boolean>(false); const [busy, setBusy] = useState<boolean>(false); const [error, setError] = useState<string>("");
  function close(): void { dialog.current?.close(); setOpened(false); trigger.current?.focus(); }
  function retainFocus(event: KeyboardEvent<HTMLDialogElement>): void {
    if (event.key !== "Tab") return;
    const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],summary,[tabindex]"))
      .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
    const first = elements[0]; const last = elements.at(-1);
    if (!first || !last) throw new Error("원본 확대 화면의 닫기 버튼을 찾지 못했어요.");
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  async function open(): Promise<void> {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "HEAD", cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error(`원본 확대 권한을 확인하지 못했어요 (HTTP ${response.status}). 로그인·인출 상태와 원본을 확인해 주세요.`);
      if (controller.signal.aborted) return;
      if (!dialog.current) throw new Error("원본 확대 화면을 준비하지 못했어요. 다시 열어 주세요.");
      setOpened(true); dialog.current.showModal();
    } catch (cause: unknown) { if (controller.signal.aborted) return; if (!(cause instanceof Error)) throw cause; setError(cause.message); }
    finally { if (request.current === controller) setBusy(false); }
  }
  useEffect(() => {
    const element = dialog.current;
    function conceal(): void { request.current?.abort(); element?.close(); setOpened(false); }
    function visibility(): void { if (document.visibilityState === "hidden") conceal(); }
    window.addEventListener("pagehide", conceal); window.addEventListener(RECALL_START_EVENT, conceal); document.addEventListener("visibilitychange", visibility);
    return () => { request.current?.abort(); element?.close(); window.removeEventListener("pagehide", conceal); window.removeEventListener(RECALL_START_EVENT, conceal); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return <div><button type="button" ref={trigger} disabled={busy} onClick={() => void open()} aria-haspopup="dialog">{label} 크게 보기</button>{error && <p role="alert">{error}</p>}
    <dialog className="original-dialog" ref={dialog} aria-labelledby={title} onKeyDown={retainFocus} onCancel={event => { event.preventDefault(); close(); }}>
      <header><h2 id={title}>{label}</h2><button type="button" onClick={close}>확대 화면 닫기</button></header><p>확대 비율은 방향키로 조절해요. 원본 이동 영역에 초점을 두면 방향키로 이동할 수 있어요. Escape로 닫을 수 있어요.</p>
      {opened && children}
    </dialog>
  </div>;
}
