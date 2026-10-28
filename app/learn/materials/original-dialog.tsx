"use client";

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowLeft } from "lucide-react";
import { Dialog, DialogTrigger, DialogPortal, DialogOverlay, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";
import { originalErrorText, originalFailure } from "./original-failure";
import "./original.css";

type OriginalDialogProps = Readonly<{ label: string; url: string; children: ReactNode }>;

/** 확대 전에 서버 권한을 확인하며 닫기·인출·화면 이탈 시 원본 자식을 해제합니다. */
export function OriginalDialog(props: OriginalDialogProps): ReactElement {
  return <OriginalDialogSession key={`${props.url}:${props.label}`} {...props} />;
}
function OriginalDialogSession({ label, url, children }: OriginalDialogProps): ReactElement {
  const request = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const [opened, setOpened] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  function close(): void { request.current?.abort(); setOpened(false); }
  async function open(): Promise<void> {
    request.current?.abort();
    const controller: AbortController = new AbortController(); request.current = controller; setBusy(true); setError("");
    try {
      const response: Response = await fetch(url, { method: "HEAD", cache: "no-store", credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw originalFailure(`원본 확대 권한을 확인하지 못했어요 (HTTP ${response.status}). 로그인·인출 상태와 원본을 확인해 주세요.`);
      if (!controller.signal.aborted && request.current === controller) setOpened(true);
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      setError(originalErrorText(cause));
    } finally { if (request.current === controller) setBusy(false); }
  }
  useEffect((): (() => void) => {
    function conceal(): void { request.current?.abort(); setOpened(false); }
    function visibility(): void { if (document.visibilityState === "hidden") conceal(); }
    window.addEventListener("pagehide", conceal); window.addEventListener(RECALL_START_EVENT, conceal); document.addEventListener("visibilitychange", visibility);
    return (): void => { request.current?.abort(); window.removeEventListener("pagehide", conceal); window.removeEventListener(RECALL_START_EVENT, conceal); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return <div>
    <Dialog open={opened} onOpenChange={(value): void => { if (value) void open(); else close(); }} modal>
      <DialogTrigger asChild><button type="button" className="alter-control alter-button" disabled={busy} aria-busy={busy}>{label} 크게 보기</button></DialogTrigger>
      <DialogPortal>
        <DialogOverlay data-alter-ui className="alter-overlay" />
        <DialogPrimitive.Content data-alter-ui className="alter-dialog alter-original-dialog" onOpenAutoFocus={(event): void => {
          event.preventDefault();
          if (heading.current === null) throw new TypeError("원본 뷰어 제목이 준비되지 않았습니다.");
          heading.current.focus();
        }} onInteractOutside={(event): void => event.preventDefault()}>
          <div className="alter-dialog-header">
            <DialogClose asChild><button type="button" className="alter-original-back" aria-label="자료로 돌아가기 · 확대 화면 닫기"><ArrowLeft aria-hidden="true" /><span>자료로</span></button></DialogClose>
            <DialogTitle ref={heading} tabIndex={-1} className="alter-subheading alter-focus">{label}</DialogTitle>
          </div>
          <DialogDescription className="alter-caption">확대 비율은 방향키로 조절해요. 원본 이동 영역에서는 방향키로 이동하고, Escape로 닫을 수 있어요.</DialogDescription>
          <div className="alter-dialog-body"><div className="alter-original-content">{opened && children}</div></div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
    {busy && <p className="alter-caption" role="status">원본 접근 권한을 확인하고 있어요.</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
