"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { readBrowserBackupArchive } from "@/lib/backup/browser-archive";
import { backupFailureMessage } from "@/lib/backup/browser-request";
import { restoreChallenge } from "@/lib/backup/restore-authority";
import { activateBrowserRestore, browserRestoreApproval, prepareBrowserRestore, runBrowserRestore } from "@/lib/backup/browser-restore";
import type { BrowserRestoreOutcome } from "@/lib/backup/browser-restore";
import { RestoreSteps, RestoreSummary } from "./restore-steps";
const envelope = z.object({ challenge: restoreChallenge, approval: browserRestoreApproval }).strict();
function subscribeStorage(changed: () => void): () => void { window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed); }
const serverSnapshot = (): string => "";
export function RestoreTargetClient({ storageKey }: Readonly<{ storageKey: string }>): ReactElement {
  const savedId = useSyncExternalStore(subscribeStorage, () => localStorage.getItem(storageKey) ?? "", serverSnapshot); const [enteredId, setId] = useState<string | null>(null); const id: string = enteredId ?? savedId;
  const [backup, setBackup] = useState<File | null>(null); const [approvalFile, setApprovalFile] = useState<File | null>(null); const [busy, setBusy] = useState<boolean>(false); const [canStop, setCanStop] = useState<boolean>(false); const [error, setError] = useState<string>(""); const [message, setMessage] = useState<string>(""); const [outcome, setOutcome] = useState<BrowserRestoreOutcome | null>(null); const [download, setDownload] = useState<string | null>(null);
  const inFlight = useRef<boolean>(false);
  const abort = useRef<AbortController | null>(null); const url = useRef<string | null>(null);
  useEffect(() => () => { abort.current?.abort(); if (url.current) URL.revokeObjectURL(url.current); }, []);
  async function prepare(): Promise<void> {
    if (inFlight.current) return; inFlight.current = true;
    setBusy(true); setError(""); setDownload(null); try { const challenge = await prepareBrowserRestore({ fetch: fetch.bind(globalThis), signal: new AbortController().signal }, crypto.randomUUID()); if (url.current) URL.revokeObjectURL(url.current); const next = URL.createObjectURL(new Blob([JSON.stringify(challenge)], { type: "application/json" })); url.current = next; setDownload(next); setMessage("빈 대상 저장소를 확인했습니다. 요청 파일을 원본 사이트에서 승인해 주세요."); } catch (failure: unknown) { setError(backupFailureMessage(failure)); } finally { setBusy(false); inFlight.current = false; }
  }
  async function restore(): Promise<void> {
    if (inFlight.current) return; inFlight.current = true;
    setBusy(true); setCanStop(true); setError(""); setOutcome(null); const controller = new AbortController(); abort.current = controller;
    try { if (!backup || !approvalFile || approvalFile.size > 16384) throw new Error("백업 TAR와 원본 사이트에서 받은 승인 JSON을 선택해 주세요.");
      const selected: string = recordId.parse(id || crypto.randomUUID()); setId(selected); localStorage.setItem(storageKey, selected);
      const input = envelope.parse(JSON.parse(await approvalFile.text())); const archive = await readBrowserBackupArchive(backup, controller.signal, setMessage);
      const outcome = await runBrowserRestore(archive, selected, input.challenge, input.approval, { fetch: fetch.bind(globalThis), signal: controller.signal, progress: setMessage });
      controller.signal.throwIfAborted(); setOutcome(outcome); setMessage(outcome.state === "activated" ? "이미 활성화한 복원입니다. 학습 공간에서 결과를 확인하세요." : "기록·출처·원본 대조가 통과했습니다. 아직 학습 공간은 잠겨 있습니다.");
    } catch (failure: unknown) { setError(backupFailureMessage(failure)); setMessage("완료 상태를 확인하지 못했어요. 같은 작업 ID와 파일로 이어서 확인해 주세요."); } finally { setBusy(false); setCanStop(false); abort.current = null; inFlight.current = false; }
  }
  async function activate(): Promise<void> {
    if (inFlight.current || outcome?.state !== "verified" || outcome.runId !== id) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await activateBrowserRestore({ fetch: fetch.bind(globalThis), signal: new AbortController().signal }, outcome.runId);
      setOutcome({ ...outcome, state: "activated" }); setMessage("검증된 학습 기록을 활성화했습니다. AI 예산과 외부 연동 실행 권한은 미확인 상태로 유지됩니다.");
    } catch (failure: unknown) { setError(backupFailureMessage(failure)); setMessage("활성화 완료를 확인하지 못했어요. 같은 복원 작업의 상태를 확인해 주세요."); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <section className="backup-tools restore-tools" aria-label="격리된 저장소 복원"><h2>별도 검증 환경에 복원</h2><p>현재 서버는 복원 시험 전용이에요. 검증과 활성화가 끝나기 전에는 학습 화면이 잠겨 있어요.</p>
    <RestoreSteps outcome={outcome} busy={busy}/>
    <section className="restore-step" aria-label="복원 대상 준비"><h3>대상 준비</h3><button className="alter-control alter-button" data-tone="secondary" type="button" disabled={busy} onClick={() => { void prepare(); }}>빈 저장소 확인 및 복원 요청 만들기</button>{download && <p><a className="alter-link" href={download} download="ALTER-restore-request.json">복원 요청 파일 다운로드</a></p>}<p>요청 파일을 원본 사이트에 전달해 복원 승인을 받아 주세요.</p></section>
    <section className="restore-step" aria-label="승인 파일과 백업 검증"><h3>승인 파일과 백업</h3>
      <label className="alter-field">완료 백업 TAR<input className="alter-control alter-file" type="file" accept=".tar,application/x-tar" disabled={busy} onChange={event => { setBackup(event.target.files?.[0] ?? null); setOutcome(null); setMessage(""); setError(""); }}/></label>
      <label className="alter-field">원본에서 받은 복원 승인 JSON<input className="alter-control alter-file" type="file" accept=".json,application/json" disabled={busy} onChange={event => { setApprovalFile(event.target.files?.[0] ?? null); setOutcome(null); setMessage(""); setError(""); }}/></label>
      <label className="alter-field">복원 작업 ID<input className="alter-control alter-input" value={id} disabled={busy} placeholder="새 복원은 자동으로 생성" onChange={event => { setId(event.target.value); setOutcome(null); setMessage(""); setError(""); }}/></label>
      <div className="backup-actions"><button className="alter-control alter-button" data-tone="primary" type="button" disabled={busy || !backup || !approvalFile} onClick={() => { void restore(); }}>{id ? "같은 복원 이어가기" : "파일 검사 후 복원 실행"}</button>{busy && canStop && <button className="alter-control alter-button" data-tone="secondary" type="button" onClick={() => abort.current?.abort()}>전송 중단</button>}</div>
    </section>
    <p role="status" aria-live="polite">{message}</p>{error && <div role="alert"><p>{error}</p><p>승인·저장 공간·원본 검증 조건은 유지돼요. 같은 작업과 파일의 결과를 확인한 뒤 이어가 주세요.</p></div>}
    {outcome && <RestoreSummary outcome={outcome}/>}
    <section className="restore-activation" aria-label="학습 기록 활성화"><h3>학습 기록 활성화</h3><p>검증된 기록을 이 복원 대상의 학습 화면에서 사용하도록 열어요. 원본 사이트와 새 AI·Google 실행 권한은 변경하지 않아요.</p>
      {outcome?.state === "verified" ? <button className="alter-control alter-button" data-tone="danger" type="button" disabled={busy} onClick={() => { void activate(); }}>검증된 학습 기록 활성화</button> : <p>{outcome?.state === "activated" ? "활성화한 기록을 학습 공간에서 확인해 주세요." : "같은 복원 작업의 검증 통과를 확인한 뒤 활성화할 수 있어요."}</p>}
    </section><a className="alter-link" href="/learn">학습 공간 확인</a>
  </section>;
}
