"use client";
import { ServiceFailureHelp } from "../service-availability";
import { GoogleDataClient } from "./google-data-client";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { clientReady, serverReady, subscribeToHydration } from "@/lib/client-ready";
import type { GoogleConnectionView } from "@/lib/google/view";
import { googleConnectionCanUseData, googleConnectionOutcome } from "@/lib/google/view";

const labels: Readonly<Record<NonNullable<GoogleConnectionView["connection"]>["state"], string>> = { active: "Google 계정 연결됨", partial: "일부 권한만 연결됨", refreshing: "Google 연결 갱신 중", "refresh-unknown": "Google 갱신 결과 확인 필요", reconsent: "Google 동의 다시 필요", disconnecting: "Google 연결 해제 중", disconnected: "Google 연결 해제됨" };
export function GoogleConnectionClient({ initial, outcome }: Readonly<{ initial: GoogleConnectionView; outcome: string | null }>): ReactElement {
  const router = useRouter();
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [working, setWorking] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(googleConnectionOutcome(outcome, initial.connection));
  const busy: boolean = working || !ready;
  const connection = initial.connection;
  const connect = async (): Promise<void> => {
    setWorking(true); setMessage(null);
    try {
      const body = connection === null ? { kind: "connect" } : { kind: "reconnect", connectionId: connection.connectionId, generation: connection.generation };
      const response: Response = await fetch("/api/google/oauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
      const result: unknown = await response.json();
      if (!response.ok) { setMessage("Google 연결을 시작하지 못했어요. 연결 설정과 현재 상태를 확인해 주세요."); return; }
      if (typeof result !== "object" || result === null || !("authorizationUrl" in result) || typeof result.authorizationUrl !== "string") throw new Error("Google 연결 주소가 없어요.");
      const target: URL = new URL(result.authorizationUrl);
      if (target.origin !== "https://accounts.google.com" || target.pathname !== "/o/oauth2/v2/auth") throw new Error("Google 연결 주소를 확인하지 못했어요.");
      window.location.assign(target.toString());
    } catch (error: unknown) { if (error instanceof Error) setMessage("Google 연결 응답을 확인하지 못했어요. 상태를 새로 확인해 주세요."); else throw error; }
    finally { setWorking(false); }
  };
  const disconnect = async (): Promise<void> => {
    if (connection === null) return;
    setWorking(true); setMessage(null);
    try {
      const response: Response = await fetch("/api/google/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: connection.connectionId, generation: connection.generation }), cache: "no-store" });
      if (!response.ok) {
        const result: unknown = await response.json();
        setMessage(typeof result === "object" && result !== null && "operation" in result && result.operation === "disconnect-still-running" ? "아직 해제가 진행 중일 수 있어요. 해제 시작 후 2분이 지나면 다시 확인해 주세요." : "Google 연결 해제 결과를 확인하지 못했어요. 상태를 새로 확인해 주세요.");
        return;
      }
      router.refresh();
    } catch (error: unknown) { if (error instanceof Error) setMessage("응답을 확인하지 못했어요. 상태를 새로 확인해 주세요."); else throw error; }
    finally { setWorking(false); }
  };
  return <><section className="storage-check" aria-label="Google 연결 상태" inert={!ready}>
    <h2>{connection === null ? "아직 연결하지 않았어요" : labels[connection.state]}</h2>
    {initial.configurationIssue && <><p role="status">{initial.configurationIssue}</p><ServiceFailureHelp/></>}
    {message && <p role="status">{message}</p>}
    {connection && <><p>{connection.email}</p>{googleConnectionCanUseData(connection) && <><p>선택한 파일: {connection.filesAllowed ? "권한 승인됨" : "권한 필요"} · ALTER 전용 캘린더: {connection.calendarAllowed ? "권한 승인됨" : "권한 필요"}</p>{connection.refreshExpiresAt !== null && <p>동의 유효기간: {new Date(connection.refreshExpiresAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>}</>}{connection.state === "disconnected" && connection.providerRevocation === "revoked" && <p>Google 접근 권한을 철회하고 저장 토큰을 제거했어요.</p>}{connection.state === "disconnected" && connection.providerRevocation !== "revoked" && <p role="status">ALTER의 저장 토큰은 제거했지만 Google 측 철회는 확인되지 않았어요. <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Google 계정의 연결 관리</a>에서 확인해 주세요.</p>}</>}
    <p><button className="storage-check-button" disabled={busy || !initial.configured || connection?.state === "disconnecting"} onClick={() => { void connect(); }}>{working ? "처리 중…" : connection === null ? "Google 연결하기" : "Google 다시 연결하기"}</button></p>
    {connection?.state === "disconnecting" && <p>해제 시작 후 2분이 지나도 상태가 바뀌지 않으면 아래 버튼으로 중단된 해제를 확인해 주세요. Google 측 철회 여부는 별도로 표시해요.</p>}
    {connection && connection.state !== "disconnected" && <p><button className="storage-check-button" disabled={busy} onClick={() => { void disconnect(); }}>{connection.state === "disconnecting" ? "중단된 해제 확인" : "Google 연결 해제"}</button></p>}
    <button className="storage-check-button" disabled={busy} onClick={() => { router.refresh(); }}>연결 상태 새로 확인</button>
  </section>{connection && googleConnectionCanUseData(connection) && <GoogleDataClient key={`${connection.connectionId}:${connection.generation}`} connection={connection} />}</>;
}
