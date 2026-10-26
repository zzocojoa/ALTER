"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { backupBrowserPost } from "@/lib/backup/browser-request";
import { restoreChallenge, restoreStorageIdentity } from "@/lib/backup/restore-authority";
import type { RestoreChallenge } from "@/lib/backup/restore-authority";
import { browserRestoreApproval } from "@/lib/backup/browser-restore";
export function RestoreSourceClient(): ReactElement {
  const [backupId, setBackupId] = useState<string>(""); const [challenge, setChallenge] = useState<RestoreChallenge | null>(null); const [identity, setIdentity] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false); const [error, setError] = useState<string>(""); const [download, setDownload] = useState<string | null>(null); const url = useRef<string | null>(null);
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);
  async function register(): Promise<void> {
    setBusy(true); setError(""); try { const result = z.object({ identity: restoreStorageIdentity }).passthrough().parse(await backupBrowserPost({ fetch: fetch.bind(globalThis), signal: new AbortController().signal }, "/api/backup/storage", {})); setIdentity(JSON.stringify(result.identity, null, 2)); } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "원본 저장소 확인에 실패했습니다."); } finally { setBusy(false); }
  }
  async function loadChallenge(file: File | undefined): Promise<void> {
    setChallenge(null); setDownload(null); setError(""); try { if (!file || file.size > 4096) throw new Error("대상에서 받은 복원 요청 JSON 파일을 선택해 주세요."); setChallenge(restoreChallenge.parse(JSON.parse(await file.text()))); } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "복원 요청 파일을 읽을 수 없습니다."); }
  }
  async function approve(): Promise<void> {
    setBusy(true); setError(""); setDownload(null);
    try { const id = recordId.parse(backupId); if (!challenge) throw new Error("복원 요청 파일을 먼저 선택해 주세요.");
      const approval = browserRestoreApproval.parse(await backupBrowserPost({ fetch: fetch.bind(globalThis), signal: new AbortController().signal }, `/api/backup/${id}/restore-approval`, challenge));
      if (url.current) URL.revokeObjectURL(url.current); const next = URL.createObjectURL(new Blob([JSON.stringify({ challenge, approval })], { type: "application/json" })); url.current = next; setDownload(next);
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "복원 승인을 완료하지 못했습니다."); } finally { setBusy(false); }
  }
  return <section className="backup-tools" aria-label="원본 복원 승인"><h2>별도 저장소로 복원 승인</h2><p>이 화면은 현재 학습 기록을 덮어쓰지 않습니다. 완료 백업 하나와 대상 저장소 하나에만 유효한 승인을 발급합니다.</p><button type="button" disabled={busy} onClick={() => { void register(); }}>원본 저장소 확인</button>{identity && <label>원본 저장소 식별 정보<textarea readOnly value={identity}/></label>}<label>완료 백업 ID<input value={backupId} disabled={busy} onChange={event => setBackupId(event.target.value)}/></label><label>대상에서 받은 복원 요청 파일<input type="file" accept="application/json,.json" disabled={busy} onChange={event => { void loadChallenge(event.target.files?.[0]); }}/></label>{challenge && <p>복원 대상: {challenge.target.projectId}<br/>대상 소유자: {challenge.target.owner.userId}<br/>요청 만료: {new Date(challenge.expiresAt).toLocaleString("ko-KR")}</p>}<button type="button" disabled={busy || challenge === null} onClick={() => { void approve(); }}>이 대상에 완료 백업 복원 승인</button>{error && <p role="alert">{error}</p>}{download && <p><a href={download} download={`ALTER-restore-approval-${backupId}.json`}>복원 승인 파일 다운로드</a></p>}<p>승인 파일은 지정한 대상에만 전달하세요. API 키·Google 인증 권한과 새 AI 예산은 포함하지 않습니다.</p></section>;
}
