"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { verifyExternalWorkflowConflict } from "@/lib/external/client";
import { loadGoogleReportView, sendGoogleWeeklyReport } from "@/lib/google-report/client";
import type { GoogleReportClientView } from "@/lib/google-report/client";
import { googleTransferPresentations, googleOperationLabels } from "@/lib/ui/google-transfer";
import { StatusBadge } from "@/components/alter/status";

export function GoogleReportStatus({ versionId, disabled, refreshToken }: Readonly<{ versionId: string; disabled: boolean; refreshToken: number }>): ReactElement {
  const [view, setView] = useState<GoogleReportClientView | null>(null);
  const [message, setMessage] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [fresh, setFresh] = useState<boolean>(false);
  const requestVersion = useRef<number>(0);
  const operationVersion = useRef<number>(0);
  const inFlight = useRef<boolean>(false);
  const reload = useCallback((): Promise<void> => {
    const version: number = ++requestVersion.current;
    return loadGoogleReportView(versionId).then(result => {
      if (version !== requestVersion.current) return;
      setView(result); setFresh(true);
    }).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      if (version !== requestVersion.current) return;
      setFresh(false);
      if ("status" in error && [401, 403].includes(Number(error.status))) setView(null);
      setMessage(`상태 재조회를 마치지 못했어요. 이전 확인 결과는 현재 상태를 보장하지 않아요. 다시 확인해 주세요. ${error.message}`);
    });
  }, [versionId]);
  useEffect(() => { void reload(); return (): void => { requestVersion.current += 1; }; }, [reload, refreshToken]);
  useEffect(() => (): void => { operationVersion.current += 1; }, [versionId]);
  async function resume(): Promise<void> {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setMessage("");
    const operation: number = operationVersion.current;
    try { await sendGoogleWeeklyReport(versionId, text => { if (operation === operationVersion.current) setMessage(text); }); }
    catch (error: unknown) { if (!(error instanceof Error)) throw error; if (operation === operationVersion.current) setMessage(error.message); }
    finally { try { if (operation === operationVersion.current) await reload(); } finally { inFlight.current = false; if (operation === operationVersion.current) setBusy(false); } }
  }
  async function recheck(): Promise<void> {
    if (inFlight.current || disabled) return;
    if (!view?.workflow) throw new Error("확인할 Google 작업이 없어요.");
    inFlight.current = true; setBusy(true); setMessage("");
    const operation: number = operationVersion.current;
    try { await verifyExternalWorkflowConflict(view.workflow.id); if (operation === operationVersion.current) setMessage("Google 현재 내용을 다시 확인했어요."); }
    catch (error: unknown) { if (!(error instanceof Error)) throw error; if (operation === operationVersion.current) setMessage(error.message); }
    finally { try { if (operation === operationVersion.current) await reload(); } finally { inFlight.current = false; if (operation === operationVersion.current) setBusy(false); } }
  }
  async function refresh(): Promise<void> {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try { await reload(); } finally { inFlight.current = false; setBusy(false); }
  }
  const workflow = view?.workflow;
  const presentation = workflow ? googleTransferPresentations[workflow.state] : null;
  return <section className="google-report-status" aria-label="Google 보고서 연동">
    <h3>Google 보고서</h3><p>ALTER 내부 확정본 보관과 Google 반영은 별도예요.</p>
    {!fresh && <p role="alert">현재 연동 상태 미확인{view ? " · 아래는 이전 확인 결과예요." : " · 상태를 다시 읽어 주세요."}</p>}
    {view && !view.connected && <p>Google 연결·인증 갱신 또는 파일 권한을 확인해 주세요. 내부 기록은 보관돼 있어요. <a href="/learn/google">Google 연결 확인</a></p>}
    {view && !workflow && <p>준비된 전송 작업이 없어요. 내보내기를 요청하기 전까지 Google에 쓰지 않아요.</p>}
    {workflow && presentation && <><StatusBadge label={presentation.label} tone={presentation.tone}/><p>{presentation.detail}</p><p>{workflow.operations.filter(operation => operation.state === "confirmed").length}/{workflow.operations.length}단계 확인</p><ol>{workflow.operations.map((operation, index) => <li key={index}>{index + 1}단계 · {googleOperationLabels[operation.state]}</li>)}</ol></>}
    {fresh && view?.documentUrl && <p><a className="alter-link" href={view.documentUrl} target="_blank" rel="noreferrer">검증된 주간 상세 보고서</a></p>}
    {fresh && view?.spreadsheetUrl && <p><a className="alter-link" href={view.spreadsheetUrl} target="_blank" rel="noreferrer">검증된 주간 성과표</a></p>}
    {view?.connected && workflow?.state !== "confirmed" && workflow?.state !== "conflict" && <><p>기존 작업이 있으면 같은 작업에서 미확인 단계를 확인하고 남은 전송을 이어가요.</p><button className="alter-control alter-button" data-tone="primary" disabled={disabled || busy} onClick={() => { void resume(); }}>Google 내보내기 이어서 진행</button></>}
    {view?.connected && workflow?.state === "conflict" && <><p>Google 내용을 덮어쓰지 않고 현재 결과만 다시 확인해요.</p><button className="alter-control alter-button" data-tone="secondary" disabled={disabled || busy} onClick={() => { void recheck(); }}>Google 결과 다시 확인</button></>}
    <button className="alter-control alter-button" data-tone="secondary" disabled={disabled || busy} onClick={() => { void refresh(); }}>보고서 연동 상태만 새로 확인</button>
    {message && <p role="status">{message}</p>}
  </section>;
}
