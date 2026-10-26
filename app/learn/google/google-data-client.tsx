"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { clientReady, serverReady, subscribeToHydration } from "@/lib/client-ready";
import type { GoogleConnectionView } from "@/lib/google/view";
import { googlePickerCredentials } from "@/lib/google/picker";
import type { GooglePickerSelection } from "@/lib/google/picker";
import { loadGooglePickerSdk, openGooglePicker } from "@/lib/google/picker-browser";

type GoogleClientBody = Readonly<{ connectionId: string; generation: number; role?: GooglePickerSelection["role"] }> | GooglePickerSelection | Readonly<{ leaseId: string }>;
async function postGoogleAction(path: "/api/google/storage" | "/api/google/picker" | "/api/google/picker/cancel" | "/api/google/picker/select", body: GoogleClientBody): Promise<unknown> {
  const response = await fetch(path, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
  const value: unknown = await response.json();
  if (!response.ok) { const parsed = z.object({ message: z.string().max(500) }).safeParse(value); throw new Error(parsed.success ? parsed.data.message : "Google 요청 상태를 확인하지 못했어요."); }
  return value;
}
export function GoogleDataClient({ connection }: Readonly<{ connection: NonNullable<GoogleConnectionView["connection"]> }>): ReactElement {
  const router = useRouter();
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [working, setWorking] = useState<boolean>(false);
  const [role, setRole] = useState<GooglePickerSelection["role"]>("reference");
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => (): void => { controller.current?.abort(); }, []);
  const available: boolean = ready && !working && connection.filesAllowed && ["active", "partial"].includes(connection.state);
  const storage = async (): Promise<void> => {
    setWorking(true); setMessage(null);
    try { await postGoogleAction("/api/google/storage", { connectionId: connection.connectionId, generation: connection.generation }); setMessage("Google 저장 용량을 확인했어요."); router.refresh(); }
    catch (error: unknown) { if (error instanceof Error) setMessage(error.message); else throw error; }
    finally { setWorking(false); }
  };
  const select = async (): Promise<void> => {
    setWorking(true); setMessage(null); const abort: AbortController = new AbortController(); controller.current = abort;
    try {
      const sdk = await loadGooglePickerSdk(window);
      if (abort.signal.aborted) throw new Error("파일 선택을 중단했어요.");
      const credentials = googlePickerCredentials.parse(await postGoogleAction("/api/google/picker", { connectionId: connection.connectionId, generation: connection.generation, role }));
      const outcome = await openGooglePicker(sdk, credentials, role, window.location.origin, abort.signal, Date.now);
      if (outcome.kind === "canceled") { await postGoogleAction("/api/google/picker/cancel", { leaseId: credentials.leaseId }); setMessage("파일 선택을 취소했어요."); return; }
      const result = z.object({ name: z.string(), role: z.string() }).parse(await postGoogleAction("/api/google/picker/select", outcome.selection));
      setMessage(`${result.name}의 접근 권한을 확인해 등록했어요.`); router.refresh();
    } catch (error: unknown) { if (error instanceof Error) setMessage(error.message); else throw error; }
    finally { controller.current = null; setWorking(false); }
  };
  return <section className="storage-check" aria-label="Google 파일 선택" inert={!ready}>
    <h2>사용할 파일 선택</h2>
    <p>저장 용량을 확인한 뒤 Google에서 사용할 파일을 직접 선택해 주세요. 참고 자료는 읽기만 허용하고, 보고서와 성과표의 쓰기 대상은 따로 선택해요.</p>
    <button className="storage-check-button" disabled={!available} onClick={() => { void storage(); }}>Google 저장 용량 확인</button>
    <label>파일 용도<select value={role} disabled={!available} onChange={event => setRole(z.enum(["reference", "docs-target", "sheets-target"]).parse(event.target.value))}><option value="reference">참고 자료 읽기</option><option value="docs-target">상세 보고서 문서</option><option value="sheets-target">성과표 스프레드시트</option></select></label>
    <button className="storage-check-button" disabled={!available} onClick={() => { void select(); }}>{working ? "확인 중…" : "Google에서 파일 선택"}</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
