"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { recordId } from "@/lib/domain/contracts";
import { openBackupBrowserStorage } from "@/lib/backup/browser-files";
import { exportBrowserBackup } from "@/lib/backup/browser-export";
import { backupFailureMessage } from "@/lib/backup/browser-request";
import { BackupProgress } from "./backup-progress";
import type { BackupSummary } from "./backup-progress";

function subscribeStorage(changed: () => void): () => void { window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed); }
const serverSnapshot = (): string => "";
export function BackupClient({ storageKey }: Readonly<{ storageKey: string }>): ReactElement {
  const savedId: string = useSyncExternalStore(subscribeStorage, () => localStorage.getItem(storageKey) ?? "", serverSnapshot);
  const [enteredId, setId] = useState<string | null>(null); const id: string = enteredId ?? savedId;
  const [busy, setBusy] = useState<boolean>(false); const [message, setMessage] = useState<string>(""); const [error, setError] = useState<string>(""); const [download, setDownload] = useState<string | null>(null);
  const [summary, setSummary] = useState<BackupSummary | null>(null); const [requested, setRequested] = useState<boolean>(false);
  const controller = useRef<AbortController | null>(null); const downloadUrl = useRef<string | null>(null); const inFlight = useRef<boolean>(false);
  useEffect(() => () => { controller.current?.abort(); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);
  function clearArtifact(): void { if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = null; setDownload(null); setSummary(null); setRequested(false); }
  async function run(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true; clearArtifact(); setBusy(true); setError(""); setMessage("브라우저 저장 공간 확인");
    const abort = new AbortController(); controller.current = abort;
    try {
      const selected: string = recordId.parse(id || crypto.randomUUID()); setId(selected); localStorage.setItem(storageKey, selected);
      const storage = await openBackupBrowserStorage(selected); abort.signal.throwIfAborted();
      const result = await exportBrowserBackup(selected, { fetch: fetch.bind(globalThis), storage, signal: abort.signal, progress: setMessage });
      abort.signal.throwIfAborted();
      const url: string = URL.createObjectURL(result.archive); downloadUrl.current = url; setDownload(url);
      setSummary({ tables: result.manifest.counts.length, pages: result.manifest.pages.length, originals: result.manifest.objects.length });
      setMessage("백업 수신·검증 완료. 아래 파일을 내려받아 보관해 주세요.");
    } catch (failure: unknown) { setError(backupFailureMessage(failure)); setMessage("이번 수신은 완료로 확인하지 못했어요."); }
    finally { setBusy(false); controller.current = null; inFlight.current = false; }
  }
  function fresh(): void { if (inFlight.current) return; localStorage.removeItem(storageKey); setId(""); clearArtifact(); setMessage(""); setError(""); }
  return <section className="backup-tools backup-export" aria-label="백업 받기"><h2>학습 기록과 원본 받기</h2>
    <p>파일을 나눠 받아 브라우저 저장소에서 검증한 뒤 TAR 파일로 묶어요. AI·Google API는 호출하지 않아요.</p>
    <BackupProgress busy={busy} failed={error !== ""} summary={summary} requested={requested}/>
    <label className="alter-field">백업 ID<input className="alter-control alter-input" value={id} disabled={busy} onChange={event => { setId(event.target.value); clearArtifact(); setError(""); setMessage(""); }} placeholder="새 백업은 자동으로 생성"/></label>
    <div className="backup-actions"><button className="alter-control alter-button" data-tone="primary" type="button" disabled={busy} onClick={() => { void run(); }}>{id ? "같은 백업 이어받기" : "새 백업 받기"}</button>{busy && <button className="alter-control alter-button" data-tone="secondary" type="button" onClick={() => controller.current?.abort()}>수신 중단</button>}{!busy && id && <button className="alter-control alter-button" data-tone="secondary" type="button" onClick={fresh}>새 백업 준비</button>}</div>
    <p role="status" aria-live="polite">{message}</p>
    {error && <div role="alert"><p>{error}</p><p>원본과 기존 예약은 변경하지 않았어요. 같은 백업 ID로 결과를 확인한 뒤 이어받아 주세요.</p><a className="alter-link" href="/learn">소유자 접근 상태 확인</a></div>}
    {download && <a className="alter-link backup-download" href={download} download={`ALTER-backup-${id}.tar`} onClick={() => setRequested(true)}>검증한 백업 파일 다운로드</a>}
    <p className="alter-caption">API 키와 Google 인증 토큰은 포함하지 않아요. 브라우저 데이터를 지우면 임시 파일도 사라지니 다운로드한 파일을 따로 보관해 주세요.</p>
  </section>;
}
