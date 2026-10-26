"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { recordId } from "@/lib/domain/contracts";
import { openBackupBrowserStorage } from "@/lib/backup/browser-files";
import { exportBrowserBackup } from "@/lib/backup/browser-export";

function subscribeStorage(changed: () => void): () => void { window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed); }
const serverSnapshot = (): string => "";
export function BackupClient({ storageKey }: Readonly<{ storageKey: string }>): ReactElement {
  const savedId: string = useSyncExternalStore(subscribeStorage, () => localStorage.getItem(storageKey) ?? "", serverSnapshot);
  const [enteredId, setId] = useState<string | null>(null); const id: string = enteredId ?? savedId; const [busy, setBusy] = useState<boolean>(false); const [message, setMessage] = useState<string>(""); const [error, setError] = useState<string>(""); const [download, setDownload] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null); const downloadUrl = useRef<string | null>(null);
  useEffect(() => () => { controller.current?.abort(); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); }, []);
  async function run(): Promise<void> {
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = null; setDownload(null);
    setBusy(true); setError(""); setMessage("브라우저 저장 공간 확인");
    try {
      const selected: string = recordId.parse(id || crypto.randomUUID()); setId(selected); localStorage.setItem(storageKey, selected);
      const abort = new AbortController(); controller.current = abort;
      const storage = await openBackupBrowserStorage(selected);
      const result = await exportBrowserBackup(selected, { fetch: fetch.bind(globalThis), storage, signal: abort.signal, progress: setMessage });
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); const url: string = URL.createObjectURL(result.archive); downloadUrl.current = url; setDownload(url);
      setMessage(`백업 수신·검증 완료 · ${result.manifest.counts.length}개 테이블 · ${result.manifest.pages.length}개 기록 파일 · ${result.manifest.objects.length}개 원본. 아래 파일을 내려받아 보관하세요.`);
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "백업 중 알 수 없는 오류가 발생했습니다. 같은 백업 ID로 상태를 확인해 주세요."); }
    finally { setBusy(false); controller.current = null; }
  }
  function fresh(): void { localStorage.removeItem(storageKey); setId(""); setDownload(null); setMessage(""); setError(""); if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); downloadUrl.current = null; }
  return <section className="backup-tools" aria-label="백업 받기"><h2>학습 기록과 원본 받기</h2><p>백업 중에는 다른 탭에서 학습 기록을 수정하지 마세요. 원본과 정답을 포함하므로 진행 중인 답안을 제출한 뒤 시작해 주세요.</p><p>파일을 나눠 받아 브라우저 저장소에서 체크섬을 확인한 뒤 하나의 TAR 파일로 제공합니다. AI·Google API는 호출하지 않아요.</p><label>백업 ID<input value={id} disabled={busy} onChange={event => setId(event.target.value)} placeholder="새 백업은 자동으로 생성" style={{ width: "100%", overflowWrap: "anywhere" }}/></label><div className="backup-actions" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1rem" }}><button type="button" disabled={busy} onClick={() => { void run(); }}>{id ? "같은 백업 이어받기" : "새 백업 받기"}</button>{busy && <button type="button" onClick={() => controller.current?.abort()}>수신 중단</button>}{!busy && id && <button type="button" onClick={fresh}>새 백업 준비</button>}</div><p role="status" aria-live="polite">{message}</p>{error && <p role="alert">{error}</p>}{download && <p><a href={download} download={`ALTER-backup-${id}.tar`}>검증한 백업 파일 다운로드</a></p>}<p>API 키와 Google 인증 토큰은 백업에 포함하지 않습니다. 브라우저 데이터를 지우면 여기 받은 임시 파일도 사라지니 다운로드한 파일을 따로 보관하세요.</p></section>;
}
