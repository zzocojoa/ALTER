"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { canonicalJson } from "@/lib/domain/contracts";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";
import { resultDraft, type ResultDraft, type ResultRequest } from "@/lib/results/contracts";
import { librarianJson, LibrarianRequestError } from "../library/client-api";
import { readResultIntent, saveResultIntent, clearResultIntent, resultIntent, requireResultResponse, type ResultIntent } from "./request-state";
import { ResultHistory } from "./result-history";
import type { ResultHistoryItem } from "@/lib/results/history";
import { ResultPanel } from "./result-panel";

export function ResultClient({ initial, history }: Readonly<{ initial: ResultDraft; history: readonly ResultHistoryItem[] }>): ReactElement {
  const [draft, setDraft] = useState<ResultDraft>(initial); const latest = useRef<ResultDraft>(initial);
  const [busy, setBusy] = useState<boolean>(false); const inFlight = useRef<boolean>(false);
  const [error, setError] = useState<string>(""); const [uncertain, setUncertain] = useState<boolean>(false);
  const [covered, setCovered] = useState<boolean>(false); const epoch = useRef<number>(0);
  const restoreWanted = useRef<boolean>(false); const [restoreRequest, setRestoreRequest] = useState<number>(0);
  const pending = useRef<ResultIntent | null>(null); const [ready, setReady] = useState<boolean>(false);
  const [intentIssue, setIntentIssue] = useState<string | null>(null); const [needsRefresh, setNeedsRefresh] = useState<boolean>(false);
  useEffect((): (() => void) => {
    const timer = setTimeout((): void => {
      try { pending.current = readResultIntent(initial.id); setUncertain(pending.current !== null); }
      catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setIntentIssue("보관된 확정 요청을 읽지 못했어요. 브라우저 저장소 상태를 확인하고 새로고침해 주세요."); setError(cause.message); }
      setReady(true);
    }, 0);
    return (): void => clearTimeout(timer);
  }, [initial.id]);
  const refresh = useCallback(async (): Promise<void> => {
    if (inFlight.current || !ready) return; inFlight.current = true; setBusy(true); setError(""); restoreWanted.current = false;
    const generation: number = epoch.current;
    try {
      const next = resultDraft.parse(await librarianJson(`/api/results?id=${encodeURIComponent(initial.id)}`, { method: "GET" }));
      requireResultResponse(latest.current, next);
      if (generation !== epoch.current) throw new Error("화면을 가린 뒤 도착한 이전 조회는 적용하지 않았어요. 최신 기록을 다시 확인해 주세요.");
      if (next.confirmation) { clearResultIntent(initial.id); pending.current = null; setUncertain(false); }
      latest.current = next; setDraft(next); setCovered(false); setNeedsRefresh(false);
    } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; if (cause instanceof LibrarianRequestError && [401,403].includes(cause.status)) setCovered(true); setError(cause.message); }
    finally { inFlight.current = false; setBusy(false); }
  }, [initial.id, ready]);
  useEffect((): (() => void) => {
    function hide(): void { epoch.current += 1; restoreWanted.current = false; setCovered(true); }
    function show(): void { restoreWanted.current = true; setCovered(true); setRestoreRequest((value): number => value + 1); }
    function visibility(): void { if (document.visibilityState === "hidden") hide(); else show(); }
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener(RECALL_START_EVENT, hide); document.addEventListener("visibilitychange", visibility);
    return (): void => { window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener(RECALL_START_EVENT, hide); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect((): (() => void) | void => {
    if (!covered || busy || !ready || !restoreWanted.current) return;
    const timer = setTimeout((): void => { void refresh(); }, 0); return (): void => clearTimeout(timer);
  }, [covered, busy, ready, restoreRequest, refresh]);
  async function confirm(): Promise<void> {
    if (inFlight.current || !ready || covered || intentIssue || needsRefresh || draft.confirmation || !pending.current && !draft.canConfirm) return;
    const input: ResultRequest = { id: draft.id, expectedVersion: draft.version, expectedSessionVersion: draft.sessionVersion, expectedOfficialVersion: draft.officialVersion, fingerprint: draft.fingerprint };
    const attempt: ResultIntent = pending.current ?? resultIntent.parse({ input, key: crypto.randomUUID() });
    try { saveResultIntent(attempt); }
    catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setIntentIssue("확정 요청 식별자를 보관하지 못해 전송하지 않았어요. 브라우저 저장소 상태를 확인해 주세요."); setError(cause.message); return; }
    pending.current = attempt; inFlight.current = true; setBusy(true); setError("");
    try {
      const next = resultDraft.parse(await librarianJson("/api/results", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": attempt.key }, body: canonicalJson(attempt.input) }));
      requireResultResponse(latest.current, next);
      if (!next.confirmation) throw new Error("확정 응답에 공식 기록이 없어요. 같은 요청으로 처리 결과를 확인해 주세요.");
      clearResultIntent(initial.id); pending.current = null; setUncertain(false); latest.current = next; setDraft(next);
    } catch (cause: unknown) {
      if (!(cause instanceof Error)) throw cause;
      if (cause instanceof LibrarianRequestError && cause.status >= 400 && cause.status < 500) {
        if ([401,403].includes(cause.status)) setCovered(true);
        clearResultIntent(initial.id); pending.current = null; setNeedsRefresh(true);
      }
      setError(cause.message); setUncertain(pending.current !== null);
    } finally { inFlight.current = false; setBusy(false); }
  }
  const confirmIssue: string | null = intentIssue ?? (needsRefresh ? "기록 버전이나 근거가 바뀌었어요. 서버 최신 기록을 조회한 뒤 다시 확인해 주세요." : null);
  return <div inert={!ready}>{covered ? <section><p>서버에서 로그인과 최신 기록을 다시 확인하고 있어요.</p>{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={(): void => { void refresh(); }}>다시 확인</button></section> : <><ResultHistory records={history} selectedId={draft.id}/><ResultPanel draft={draft} busy={busy} uncertain={uncertain} confirmIssue={confirmIssue} error={error} onConfirm={confirm} onRefresh={refresh}/></>}</div>;
}
