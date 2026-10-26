"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { readBrowserBackupArchive } from "@/lib/backup/browser-archive";
import { backupBrowserPost } from "@/lib/backup/browser-request";
import { restoreChallenge } from "@/lib/backup/restore-authority";
import { browserRestoreApproval, prepareBrowserRestore, runBrowserRestore } from "@/lib/backup/browser-restore";
const envelope = z.object({ challenge: restoreChallenge, approval: browserRestoreApproval }).strict();
function subscribeStorage(changed: () => void): () => void { window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed); }
const serverSnapshot = (): string => "";
export function RestoreTargetClient({ storageKey }: Readonly<{ storageKey: string }>): ReactElement {
  const savedId = useSyncExternalStore(subscribeStorage, () => localStorage.getItem(storageKey) ?? "", serverSnapshot); const [enteredId, setId] = useState<string | null>(null); const id: string = enteredId ?? savedId;
  const [backup, setBackup] = useState<File | null>(null); const [approvalFile, setApprovalFile] = useState<File | null>(null); const [busy, setBusy] = useState<boolean>(false); const [canStop, setCanStop] = useState<boolean>(false); const [error, setError] = useState<string>(""); const [message, setMessage] = useState<string>(""); const [report, setReport] = useState<string>(""); const [verified, setVerified] = useState<boolean>(false); const [download, setDownload] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null); const url = useRef<string | null>(null);
  useEffect(() => () => { abort.current?.abort(); if (url.current) URL.revokeObjectURL(url.current); }, []);
  async function prepare(): Promise<void> {
    setBusy(true); setError(""); setDownload(null); try { const challenge = await prepareBrowserRestore({ fetch: fetch.bind(globalThis), signal: new AbortController().signal }, crypto.randomUUID()); if (url.current) URL.revokeObjectURL(url.current); const next = URL.createObjectURL(new Blob([JSON.stringify(challenge)], { type: "application/json" })); url.current = next; setDownload(next); setMessage("빈 대상 저장소를 확인했습니다. 요청 파일을 원본 사이트에서 승인해 주세요."); } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "대상 저장소 확인에 실패했습니다."); } finally { setBusy(false); }
  }
  async function restore(): Promise<void> {
    setBusy(true); setCanStop(true); setError(""); setVerified(false); setReport(""); const controller = new AbortController(); abort.current = controller;
    try { if (!backup || !approvalFile || approvalFile.size > 16384) throw new Error("백업 TAR와 원본 사이트에서 받은 승인 JSON을 선택해 주세요.");
      const selected: string = recordId.parse(id || crypto.randomUUID()); setId(selected); localStorage.setItem(storageKey, selected);
      const input = envelope.parse(JSON.parse(await approvalFile.text())); const archive = await readBrowserBackupArchive(backup, controller.signal, setMessage);
      const outcome = await runBrowserRestore(archive, selected, input.challenge, input.approval, { fetch: fetch.bind(globalThis), signal: controller.signal, progress: setMessage });
      setVerified(outcome.state === "verified"); setReport(JSON.stringify(outcome.report, null, 2)); setMessage(outcome.state === "activated" ? "이미 활성화한 복원입니다. 학습 공간에서 결과를 확인하세요." : "기록·출처·원본 대조가 통과했습니다. 아직 학습 공간은 잠겨 있습니다.");
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "복원을 완료하지 못했습니다. 같은 작업 ID로 상태를 확인해 주세요."); } finally { setBusy(false); setCanStop(false); abort.current = null; }
  }
  async function activate(): Promise<void> {
    setBusy(true); setError(""); try { const result = await backupBrowserPost({ fetch: fetch.bind(globalThis), signal: new AbortController().signal }, `/api/restore/runs/${recordId.parse(id)}/activate`, {}); setReport(JSON.stringify(result, null, 2)); setVerified(false); setMessage("검증된 학습 기록을 활성화했습니다. AI 예산과 외부 연동 실행 권한은 미확인 상태로 유지됩니다."); } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "복원 활성화에 실패했습니다."); } finally { setBusy(false); }
  }
  return <section className="backup-tools" aria-label="격리된 저장소 복원"><h2>별도 검증 환경에 복원</h2><p>현재 서버는 복원 시험 전용입니다. 검증과 활성화가 끝날 때까지 학습 화면을 잠그고 AI·Google 작업을 실행하지 않습니다.</p><button type="button" disabled={busy} onClick={() => { void prepare(); }}>빈 저장소 확인 및 복원 요청 만들기</button>{download && <p><a href={download} download="ALTER-restore-request.json">복원 요청 파일 다운로드</a></p>}<label>완료 백업 TAR<input type="file" accept=".tar,application/x-tar" disabled={busy} onChange={event => { setBackup(event.target.files?.[0] ?? null); setVerified(false); }}/></label><label>원본에서 받은 복원 승인 JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={event => { setApprovalFile(event.target.files?.[0] ?? null); setVerified(false); }}/></label><label>복원 작업 ID<input value={id} disabled={busy} placeholder="새 복원은 자동으로 생성" onChange={event => { setId(event.target.value); setVerified(false); }}/></label><div className="backup-actions"><button type="button" disabled={busy || !backup || !approvalFile} onClick={() => { void restore(); }}>{id ? "같은 복원 이어가기" : "파일 검사 후 복원 실행"}</button>{busy && canStop && <button type="button" onClick={() => abort.current?.abort()}>전송 중단</button>}{verified && <button type="button" disabled={busy} onClick={() => { void activate(); }}>검증된 학습 기록 활성화</button>}</div><p role="status" aria-live="polite">{message}</p>{error && <p role="alert">{error}</p>}{report && <details open><summary>서버 검증 결과</summary><pre>{report}</pre></details>}<a href="/learn">학습 공간 확인</a></section>;
}
