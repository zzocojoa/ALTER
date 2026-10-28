import { z } from "zod";
import { requireBackupResponse } from "./browser-request.ts";
import { recordId, canonicalJson } from "../domain/contracts.ts";
import { backupCatalog } from "./catalog.ts";
import { backupBasis, backupCatalogHash, backupObjectEntry, backupPagePath, backupPolicy, validateBackupManifest, validateBackupPage } from "./contracts.ts";
import type { BackupManifest } from "./contracts.ts";
import { createBackupArchive } from "./archive.ts";
import type { BackupArchiveFile } from "./archive.ts";
import type { BackupBrowserStorage } from "./browser-files.ts";

const runSchema = z.object({ id: recordId, state: z.enum(["exporting", "database-ready", "complete", "cancelled"]), current: z.boolean(), basis: backupBasis }).strict();
const objectsSchema = z.object({ entries: z.array(backupObjectEntry).max(16), count: z.number().int().nonnegative().max(backupPolicy.maximumObjects), nextOffset: z.number().int().nonnegative().nullable() }).strict();
export type BackupExportRuntime = Readonly<{ fetch: typeof fetch; storage: BackupBrowserStorage; signal: AbortSignal; progress: (message: string) => void }>;
export type BackupExportResult = Readonly<{ manifest: BackupManifest; archive: Blob }>;
async function response(runtime: BackupExportRuntime, url: string, init: RequestInit): Promise<Response> {
  const result = await runtime.fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: runtime.signal });
  return requireBackupResponse(result, url);
}
async function post(runtime: BackupExportRuntime, url: string, value: unknown): Promise<Response> { return response(runtime, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); }
async function archiveSaved(runtime: BackupExportRuntime, manifest: BackupManifest): Promise<BackupExportResult> {
  const files: BackupArchiveFile[] = [];
  for (const entry of [...manifest.pages, ...manifest.objects]) { runtime.progress(`받은 파일 대조 · ${files.length + 1}/${manifest.pages.length + manifest.objects.length}`); files.push({ path: entry.path, file: await runtime.storage.read(entry.path, entry, runtime.signal) }); }
  files.push({ path: "manifest.json", file: await runtime.storage.saveManifest(JSON.stringify(manifest)) });
  return { manifest, archive: createBackupArchive(files) };
}
/** 서버 페이지·원본 수신 계약을 순서대로 호출하며 저장한 바이트 검증 후에만 수신을 확인합니다. */
export async function exportBrowserBackup(id: string, runtime: BackupExportRuntime): Promise<BackupExportResult> {
  recordId.parse(id); const base: string = `/api/backup/${id}`;
  const lookup = await runtime.fetch(base, { method: "GET", credentials: "same-origin", cache: "no-store", signal: runtime.signal });
  if (lookup.status === 404) z.object({ error: z.literal("missing-export") }).passthrough().parse(await lookup.json());
  const run = runSchema.parse(await (lookup.status === 404 ? await post(runtime, "/api/backup", { id }) : await requireBackupResponse(lookup, base)).json());
  if (run.id !== id) throw new Error("서버 백업 ID가 요청과 다릅니다.");
  if (run.state === "complete") {
    const manifest = validateBackupManifest(await (await response(runtime, `${base}/complete`, { method: "GET" })).json(), await backupCatalogHash());
    if (manifest.backupId !== id || canonicalJson(manifest.basis) !== canonicalJson(run.basis)) throw new Error("완료 백업 기준이 요청과 다릅니다.");
    return archiveSaved(runtime, manifest);
  }
  if (!run.current || run.state === "cancelled") throw new Error("백업 기준이 변경되었거나 중단된 작업입니다. 새 백업을 시작해 주세요.");
  let pages: number = 0;
  for (const table of backupCatalog) for (let ordinal: number = 0; ; ordinal += 1) {
    if (++pages > backupPolicy.maximumPages) throw new Error("백업 페이지 수 제한을 초과했습니다.");
    runtime.progress(`학습 기록 받기 · ${table.name} · ${ordinal + 1}쪽`);
    const url: string = `${base}/pages/${table.name}/${ordinal}`; const received = await post(runtime, url, {});
    const proof = { bytes: Number(received.headers.get("x-backup-bytes")), sha256: received.headers.get("x-backup-sha256") ?? "" };
    if (!received.body || !Number.isSafeInteger(proof.bytes) || proof.bytes < 1 || proof.bytes > backupPolicy.maximumPageBytes || !/^[a-f0-9]{64}$/.test(proof.sha256)) throw new Error("백업 페이지 전송 근거가 없습니다.");
    const file = await runtime.storage.write(backupPagePath(table.name, ordinal), received.body, proof, runtime.signal); const page = validateBackupPage(JSON.parse(await file.text()));
    if (page.backupId !== id || page.table !== table.name || page.ordinal !== ordinal || canonicalJson(page.basis) !== canonicalJson(run.basis)) throw new Error("백업 페이지 기준이 요청과 다릅니다.");
    await post(runtime, `${url}/received`, proof); if (page.final) break;
  }
  await post(runtime, `${base}/database`, {});
  let offset: number = 0;
  while (true) {
    const objects = objectsSchema.parse(await (await response(runtime, `${base}/objects?offset=${offset}`, { method: "GET" })).json());
    for (const [index, entry] of objects.entries.entries()) {
      runtime.progress(`원본 받기 · ${offset + index + 1}/${objects.count}`); const url = `${base}/objects/${offset + index}`;
      const received = await post(runtime, url, {});
      if (!received.body || Number(received.headers.get("x-backup-bytes")) !== entry.bytes || received.headers.get("x-backup-sha256") !== entry.sha256) throw new Error("원본 전송 근거가 백업 명세와 다릅니다.");
      await runtime.storage.write(entry.path, received.body, entry, runtime.signal); await post(runtime, `${url}/received`, { bytes: entry.bytes, sha256: entry.sha256 });
    }
    if (objects.nextOffset === null) break;
    if (objects.nextOffset !== offset + objects.entries.length || objects.nextOffset <= offset || objects.nextOffset >= objects.count) throw new Error("원본 목록의 이어받기 위치가 올바르지 않습니다.");
    offset = objects.nextOffset;
  }
  runtime.progress("전체 수신 완료 확인"); const manifest = validateBackupManifest(await (await post(runtime, `${base}/complete`, {})).json(), await backupCatalogHash());
  if (manifest.backupId !== id || canonicalJson(manifest.basis) !== canonicalJson(run.basis)) throw new Error("완료 백업 기준이 요청과 다릅니다.");
  return archiveSaved(runtime, manifest);
}
