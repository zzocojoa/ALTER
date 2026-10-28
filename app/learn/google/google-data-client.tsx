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

const roleLabels: Readonly<Record<GooglePickerSelection["role"], string>> = { reference: "참고 자료 읽기", "docs-target": "상세 보고서 문서", "sheets-target": "성과표 스프레드시트" };
const roleDescriptions: Readonly<Record<GooglePickerSelection["role"], string>> = { reference: "선택한 참고 자료는 읽기 대상으로 등록해요. 실제 내용을 ALTER로 가져오는 단계는 따로 진행해요.", "docs-target": "선택한 Google Docs의 쓰기 접근 권한을 등록해요. 주간 내보내기는 ALTER 전용 보고서 대상을 사용하며, 여기서 고른 문서로 바뀌지 않아요.", "sheets-target": "선택한 Google Sheets의 쓰기 접근 권한을 등록해요. 주간 내보내기는 ALTER 전용 성과표를 사용하며, 여기서 고른 표로 바뀌지 않아요." };
type SelectedGoogleFile = Readonly<{ name: string; role: GooglePickerSelection["role"] }>;
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
  const [selectedFile, setSelectedFile] = useState<SelectedGoogleFile | null>(null);
  const inFlight = useRef<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => (): void => { controller.current?.abort(); }, []);
  const available: boolean = ready && !working && connection.filesAllowed && ["active", "partial"].includes(connection.state);
  const storage = async (): Promise<void> => {
    if (inFlight.current) return; inFlight.current = true;
    setWorking(true); setMessage(null);
    try { await postGoogleAction("/api/google/storage", { connectionId: connection.connectionId, generation: connection.generation }); setMessage("Google 저장 용량을 확인했어요."); router.refresh(); }
    catch (error: unknown) { if (error instanceof Error) setMessage(error.message); else throw error; }
    finally { inFlight.current = false; setWorking(false); }
  };
  const select = async (): Promise<void> => {
    if (inFlight.current) return; inFlight.current = true;
    setWorking(true); setMessage(null); const abort: AbortController = new AbortController(); controller.current = abort;
    try {
      const sdk = await loadGooglePickerSdk(window);
      if (abort.signal.aborted) throw new Error("파일 선택을 중단했어요.");
      const credentials = googlePickerCredentials.parse(await postGoogleAction("/api/google/picker", { connectionId: connection.connectionId, generation: connection.generation, role }));
      if (credentials.connectionId !== connection.connectionId || credentials.generation !== connection.generation) throw new Error("파일 선택 인증이 현재 연결 계정·상태와 다릅니다. 연결 상태를 새로 확인해 주세요.");
      const outcome = await openGooglePicker(sdk, credentials, role, window.location.origin, abort.signal, Date.now);
      if (outcome.kind === "canceled") { await postGoogleAction("/api/google/picker/cancel", { leaseId: credentials.leaseId }); setMessage("파일 선택을 취소했어요."); return; }
      const result = z.object({ name: z.string().min(1), role: z.enum(["reference", "docs-target", "sheets-target"]) }).parse(await postGoogleAction("/api/google/picker/select", outcome.selection));
      if (result.role !== role) throw new Error("등록 응답의 파일 용도가 선택한 용도와 달라요. 연결 상태를 새로 확인해 주세요.");
      setSelectedFile(result);
      setMessage(`${result.name}의 접근 권한을 확인해 등록했어요.`); router.refresh();
    } catch (error: unknown) { if (error instanceof Error) setMessage(error.message); else throw error; }
    finally { inFlight.current = false; controller.current = null; setWorking(false); }
  };
  return <section className="storage-check google-file-selection" aria-label="Google 파일 선택" inert={!ready}>
    <h2>사용할 파일 선택</h2>
    <ol className="google-selection-steps"><li>Google 저장 용량 확인</li><li>읽기·쓰기 용도 선택</li><li>Google 선택기에서 파일 하나 선택</li></ol>
    <p>참고 자료 읽기와 문서·표의 쓰기 접근 권한을 구분해 등록해요. 파일 선택만으로 내용을 가져오거나 전송하지 않아요.</p>
    {!connection.filesAllowed && <p>선택한 파일 권한이 필요해요. 위 연결·재동의에서 허용 범위를 확인해 주세요.</p>}
    <button className="storage-check-button" disabled={!available} onClick={() => { void storage(); }}>Google 저장 용량 확인</button>
    <label>파일 용도<select value={role} disabled={!available} aria-describedby="google-file-role-description" onChange={event => setRole(z.enum(["reference", "docs-target", "sheets-target"]).parse(event.target.value))}>{Object.entries(roleLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <p id="google-file-role-description" className="google-role-description">{roleDescriptions[role]}</p>
    <button className="storage-check-button" disabled={!available} onClick={() => { void select(); }}>{working ? "확인 중…" : "Google에서 파일 선택"}</button>
    <p>선택기에서 취소하면 새 파일을 등록하지 않아요. 선택한 파일의 접근 권한을 서버에서 확인한 뒤 등록해요.</p>
    {message && <p role="status">{message}</p>}
    {selectedFile && <section className="google-card" aria-label="마지막으로 확인한 파일 선택"><h3>마지막으로 확인한 파일 선택</h3><p><strong>{selectedFile.name}</strong></p><p>{roleLabels[selectedFile.role]} · 접근 권한 확인 후 등록</p>{selectedFile.role === "reference" ? <a href="/learn/google/references">선택한 참고 자료 가져오기</a> : <a href="/learn/weekly">주간 확정본과 내보내기 검토</a>}</section>}
  </section>;
}
