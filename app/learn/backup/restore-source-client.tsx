"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { backupBrowserPost, backupFailureMessage } from "@/lib/backup/browser-request";
import { restoreChallenge, restoreStorageIdentity } from "@/lib/backup/restore-authority";
import type { RestoreChallenge, RestoreStorageIdentity } from "@/lib/backup/restore-authority";
import { browserRestoreApproval } from "@/lib/backup/browser-restore";
import { StatusBadge } from "@/components/alter/status";
import { formatUsageTime } from "../usage-format";

export function RestoreSourceClient(): ReactElement {
  const [backupId, setBackupId] = useState<string>(""); const [challenge, setChallenge] = useState<RestoreChallenge | null>(null); const [identity, setIdentity] = useState<RestoreStorageIdentity | null>(null);
  const [busy, setBusy] = useState<boolean>(false); const [error, setError] = useState<string>(""); const [download, setDownload] = useState<string | null>(null); const url = useRef<string | null>(null); const inFlight = useRef<boolean>(false);
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);
  function clearApproval(): void { if (url.current) URL.revokeObjectURL(url.current); url.current = null; setDownload(null); }
  async function register(): Promise<void> {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(""); setIdentity(null);
    try { const result = z.object({ identity: restoreStorageIdentity }).parse(await backupBrowserPost({ fetch: fetch.bind(globalThis), signal: new AbortController().signal }, "/api/backup/storage", {})); setIdentity(result.identity); }
    catch (failure: unknown) { setError(backupFailureMessage(failure)); } finally { setBusy(false); inFlight.current = false; }
  }
  async function loadChallenge(file: File | undefined): Promise<void> {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setChallenge(null); clearApproval(); setError("");
    try { if (!file || file.size > 4096) throw new Error("대상에서 받은 복원 요청 JSON 파일을 선택해 주세요."); setChallenge(restoreChallenge.parse(JSON.parse(await file.text()))); }
    catch (failure: unknown) { setError(backupFailureMessage(failure)); } finally { setBusy(false); inFlight.current = false; }
  }
  async function approve(): Promise<void> {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(""); clearApproval();
    try { const id: string = recordId.parse(backupId); if (!challenge) throw new Error("복원 요청 파일을 먼저 선택해 주세요.");
      const approval = browserRestoreApproval.parse(await backupBrowserPost({ fetch: fetch.bind(globalThis), signal: new AbortController().signal }, `/api/backup/${id}/restore-approval`, challenge));
      if (approval.backupId !== id || approval.expiresAt > challenge.expiresAt || approval.expiresAt <= Date.now()) throw new Error("복원 승인 결과의 백업·유효기간이 요청과 다릅니다. 같은 대상의 상태를 확인해 주세요.");
      const next: string = URL.createObjectURL(new Blob([JSON.stringify({ challenge, approval })], { type: "application/json" })); url.current = next; setDownload(next);
    } catch (failure: unknown) { setError(backupFailureMessage(failure)); } finally { setBusy(false); inFlight.current = false; }
  }
  return <section className="backup-tools restore-tools" aria-label="원본 복원 승인"><h2>별도 저장소로 복원 승인</h2><p>완료 백업 하나와 대상 저장소 하나에만 유효한 승인을 발급해요. 현재 학습 기록을 덮어쓰지는 않아요.</p>
    <section className="restore-step"><h3>1. 원본 저장소 확인</h3><button className="alter-control alter-button" data-tone="secondary" type="button" disabled={busy} onClick={() => { void register(); }}>원본 저장소 확인</button>{identity && <dl className="restore-summary"><div><dt>원본 사이트</dt><dd>{identity.projectId}</dd></div><div><dt>원본 소유자</dt><dd>{identity.owner.userId}</dd></div></dl>}</section>
    <section className="restore-step"><h3>2. 완료 백업과 대상 선택</h3><label className="alter-field">완료 백업 ID<input className="alter-control alter-input" value={backupId} disabled={busy} onChange={event => { setBackupId(event.target.value); clearApproval(); setError(""); }}/></label><label className="alter-field">대상에서 받은 복원 요청 파일<input className="alter-control alter-file" type="file" accept="application/json,.json" disabled={busy} onChange={event => { void loadChallenge(event.target.files?.[0]); }}/></label>
      {challenge && <div className="restore-summary"><h4>선택한 파일의 복원 대상</h4><p>서버 승인 전의 요청 정보예요.</p><dl><div><dt>대상 사이트</dt><dd>{challenge.target.projectId}</dd></div><div><dt>대상 소유자</dt><dd>{challenge.target.owner.userId}</dd></div><div><dt>요청 만료 · 서울 시간</dt><dd>{formatUsageTime(challenge.expiresAt)}</dd></div></dl></div>}
    </section>
    <section className="restore-activation"><h3>3. 선택한 대상에 승인 발급</h3><p>대상과 완료 백업 ID를 확인해 주세요. 승인 파일은 지정한 대상에만 전달해야 해요.</p><button className="alter-control alter-button" data-tone="danger" type="button" disabled={busy || challenge === null} onClick={() => { void approve(); }}>이 대상에 완료 백업 복원 승인</button></section>
    {error && <p role="alert">{error}</p>}{download && <div role="status"><StatusBadge label="승인 파일 준비 완료 · 대상에서 검증 필요" tone="warning"/><p><a className="alter-link" href={download} download={`ALTER-restore-approval-${backupId}.json`}>복원 승인 파일 다운로드</a></p></div>}
    <p className="alter-caption">API 키·Google 인증 권한과 새 AI 예산은 승인에 포함하지 않아요.</p>
  </section>;
}
