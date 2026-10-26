import { z } from "zod";
import { recordId } from "../domain/contracts.ts";
import { restoreAuthorization, restoreChallenge } from "./restore-authority.ts";
import type { RestoreChallenge } from "./restore-authority.ts";
import { archiveFile } from "./browser-archive.ts";
import type { BrowserBackupArchive } from "./browser-archive.ts";
import { backupBrowserRequest, backupBrowserPost } from "./browser-request.ts";
import type { BackupBrowserRequest } from "./browser-request.ts";
import { restorePageOrder } from "./restore-order.ts";
export const browserRestoreApproval = z.object({ token: z.string().min(1).max(8192), backupId: recordId, manifestSha256: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive() }).strict();
export type BrowserRestoreApproval = Readonly<z.infer<typeof browserRestoreApproval>>;
const browserRun = z.object({ id: recordId, state: z.enum(["receiving", "verifying", "verified", "activated", "failed"]), authorization: restoreAuthorization }).passthrough();
export type BrowserRestoreOutcome = Readonly<{ state: "verified" | "activated"; report: unknown }>;
export type BrowserRestoreRuntime = BackupBrowserRequest & Readonly<{ progress: (message: string) => void }>;
export async function prepareBrowserRestore(runtime: BackupBrowserRequest, id: string): Promise<RestoreChallenge> {
  recordId.parse(id); await backupBrowserPost(runtime, "/api/restore/storage", {}); return restoreChallenge.parse(await backupBrowserPost(runtime, "/api/restore/challenges", { id }));
}
/** 격리된 서버가 서명과 모든 저장 단계를 검증하며 이 함수는 기존 엔드포인트를 순서대로 연결합니다. */
export async function runBrowserRestore(archive: BrowserBackupArchive, id: string, challenge: RestoreChallenge, approval: BrowserRestoreApproval, runtime: BrowserRestoreRuntime): Promise<BrowserRestoreOutcome> {
  recordId.parse(id); restoreChallenge.parse(challenge); browserRestoreApproval.parse(approval);
  if (approval.backupId !== archive.manifest.backupId || approval.manifestSha256 !== archive.manifestSha256) throw new Error("복원 승인과 선택한 백업이 다릅니다.");
  const base: string = `/api/restore/runs/${id}`; const lookup = await runtime.fetch(base, { method: "GET", credentials: "same-origin", cache: "no-store", signal: runtime.signal });
  const value: unknown = await lookup.json(); const absent = z.object({ error: z.literal("wrong-backup"), field: z.literal("run-missing") }).passthrough().safeParse(value);
  if (!lookup.ok && !(lookup.status === 409 && absent.success)) throw new Error(`복원 상태 조회 실패 (${lookup.status}). 같은 작업 ID의 상태를 확인해 주세요.`);
  const run = browserRun.parse(lookup.ok ? value : await backupBrowserPost(runtime, "/api/restore/runs", { id, challengeId: challenge.id, backupId: approval.backupId, manifestSha256: approval.manifestSha256, token: approval.token }));
  if (run.id !== id || run.authorization.backupId !== archive.manifest.backupId || run.authorization.manifestSha256 !== archive.manifestSha256 || run.authorization.challenge.id !== challenge.id) throw new Error("서버 복원 작업이 선택한 백업과 다릅니다.");
  if (run.state === "failed") throw new Error("서버에서 실패로 판정한 복원입니다. 실패 원인을 확인해 주세요.");
  if (run.state === "verified" || run.state === "activated") return { state: run.state, report: run };
  if (run.state === "receiving") {
    await backupBrowserRequest(runtime, `${base}/manifest`, { method: "PUT", headers: { "content-type": "application/json" }, body: archive.manifestText });
    for (const [index, entry] of archive.manifest.pages.entries()) { runtime.progress(`기록 전송 · ${index + 1}/${archive.manifest.pages.length}`); await backupBrowserRequest(runtime, `${base}/pages/${entry.table}/${entry.ordinal}`, { method: "PUT", headers: { "content-type": "application/json" }, body: archiveFile(archive, entry.path) }); }
    for (const item of archive.originals) { const entry = archive.manifest.objects[item.ordinal]!; runtime.progress(`원본 전송 · ${item.ordinal + 1}/${archive.originals.length}`); await backupBrowserRequest(runtime, `${base}/objects/${item.ordinal}?uploadPage=${item.uploadPage}&transferPage=${item.transferPage}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: archiveFile(archive, entry.path) }); }
  }
  await backupBrowserPost(runtime, `${base}/import`, {});
  const ordered = restorePageOrder(archive.manifest);
  for (const [index, entry] of ordered.entries()) { runtime.progress(`기록 복원 · ${index + 1}/${ordered.length}`); await backupBrowserPost(runtime, `${base}/import/pages/${entry.table}/${entry.ordinal}`, {}); }
  await backupBrowserPost(runtime, `${base}/verify`, {});
  for (const [index, entry] of archive.manifest.pages.entries()) { runtime.progress(`복원 기록 대조 · ${index + 1}/${archive.manifest.pages.length}`); await backupBrowserPost(runtime, `${base}/verify/pages/${entry.table}/${entry.ordinal}`, {}); }
  for (const [ordinal] of archive.manifest.objects.entries()) { runtime.progress(`복원 원본 대조 · ${ordinal + 1}/${archive.manifest.objects.length}`); await backupBrowserPost(runtime, `${base}/verify/objects/${ordinal}`, {}); }
  const report = await backupBrowserPost(runtime, `${base}/verify/complete`, {}); return { state: "verified", report };
}
