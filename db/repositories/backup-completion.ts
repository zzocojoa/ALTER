import { z } from "zod";
import { backupCatalog } from "../../lib/backup/catalog.ts";
import type { BackupTableName } from "../../lib/backup/catalog.ts";
import { backupFailure, backupObjectEntry, backupObjectPath, backupPagePath, backupPolicy, validateBackupManifest } from "../../lib/backup/contracts.ts";
import type { BackupManifest, BackupObjectEntry } from "../../lib/backup/contracts.ts";
import { backupTextHash } from "../../lib/backup/pagination.ts";
import type { BackupPageEntry } from "../../lib/backup/pagination.ts";
import { domainFailure, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase } from "./atomic.ts";
import { backupGuard, backupPageReceipt, finishBackupDatabase, readBackupRun, requireBackupCurrent, runBackupSnapshotBatch, snapshotRead } from "./backup.ts";
import type { BackupRun, StoredPage } from "./backup.ts";
import { requireBackupObjectSet } from "./backup-objects.ts";

const acknowledgedFile = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(backupPolicy.maximumPageBytes) }).strict();
type StoredObject = Readonly<{ ordinal: number; material_id: string; upload_id: string; object_key: string; bytes: number; object_version: string; etag: string; sha256: string }>;
type Completion = Readonly<{ completed_at: number; sha256: string }>;

export async function acknowledgeBackupPage(db: AtomicDatabase, owner: SiteIdentity, id: string, table: BackupTableName, ordinal: number, checksum: string, bytes: number, now: number): Promise<void> {
  backupPagePath(table, ordinal); acknowledgedFile.parse({ sha256: checksum, bytes }); timestamp.parse(now);
  const run: BackupRun = requireBackupCurrent(await readBackupRun(db, owner, id)); const check: string = crypto.randomUUID();
  await runBackupSnapshotBatch(db, run, [
    db.prepare("UPDATE backup_pages SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE owner_id=? AND backup_id=? AND table_name=? AND ordinal=? AND sha256=? AND bytes=?").bind(now, owner.userId, id, table, ordinal, checksum, bytes),
    backupGuard(db, check, "EXISTS(SELECT 1 FROM backup_pages WHERE owner_id=? AND backup_id=? AND table_name=? AND ordinal=? AND sha256=? AND bytes=? AND acknowledged_at IS NOT NULL)", [owner.userId, id, table, ordinal, checksum, bytes]),
    db.prepare("DELETE FROM backup_checks WHERE id=?").bind(check),
  ], "backup.page-acknowledge");
}
function objectEntry(row: StoredObject): BackupObjectEntry {
  return backupObjectEntry.parse({ materialId: row.material_id, uploadId: row.upload_id, objectKey: row.object_key, path: backupObjectPath(row.ordinal), bytes: row.bytes, objectVersion: row.object_version, etag: row.etag, sha256: row.sha256 });
}
/** 반환 메타데이터의 크기도 먼저 검사해 원본 파일 수에 따른 무제한 응답 적재를 막습니다. */
async function readObjectEntries(db: AtomicDatabase, run: BackupRun, pageMetadataBytes: number): Promise<readonly BackupObjectEntry[]> {
  const size = await readStorage("backup.object-receipt-size", () => db.prepare("SELECT count(*) AS count,COALESCE(sum(length(CAST(json_object('materialId',material_id,'uploadId',upload_id,'objectKey',object_key,'path',printf('objects/%06d.bin',ordinal),'bytes',bytes,'objectVersion',object_version,'etag',etag,'sha256',sha256) AS BLOB))),0) AS bytes,count(CASE WHEN acknowledged_at IS NULL THEN 1 END) AS unacknowledged FROM backup_objects WHERE owner_id=? AND backup_id=?").bind(run.basis.ownerId, run.id).first<{ count: number; bytes: number; unacknowledged: number }>());
  if (size === null || size.count > backupPolicy.maximumObjects || size.bytes + size.count + pageMetadataBytes + 65536 > backupPolicy.maximumManifestBytes) throw backupFailure("incomplete-manifest", "manifest.metadata-size");
  if (size.unacknowledged !== 0) throw backupFailure("incomplete-download", "objects.acknowledgement");
  const result = await readStorage("backup.object-receipts", () => db.prepare("SELECT ordinal,material_id,upload_id,object_key,bytes,object_version,etag,sha256 FROM backup_objects WHERE owner_id=? AND backup_id=? ORDER BY ordinal LIMIT ?").bind(run.basis.ownerId, run.id, backupPolicy.maximumObjects + 1).all<StoredObject>());
  if (result.results.length !== size.count) throw backupFailure("export-conflict", "objects.receipts");
  return result.results.map(objectEntry);
}
function manifestFromReceipts(run: BackupRun, pages: readonly BackupPageEntry[], objects: readonly BackupObjectEntry[], completedAt: number): BackupManifest {
  return validateBackupManifest({ schemaVersion: 1, backupId: run.id, state: "complete", basis: run.basis, completedAt, checksumAlgorithm: "SHA-256", executionAuthority: "none", credentials: "excluded", pages, objects, counts: backupCatalog.map(table => ({ table: table.name, rows: pages.filter(page => page.table === table.name).reduce((count, page) => count + page.count, 0) })) }, run.basis.catalogHash);
}
export async function readCompletedBackup(db: AtomicDatabase, owner: SiteIdentity, id: string): Promise<BackupManifest> {
  const run: BackupRun = await readBackupRun(db, owner, id);
  if (run.state !== "complete") throw backupFailure("incomplete-export", "manifest.state");
  const [completion, result] = await Promise.all([
    readStorage("backup.completion", () => db.prepare("SELECT completed_at,sha256 FROM backup_completions WHERE owner_id=? AND backup_id=?").bind(owner.userId, id).first<Completion>()),
    readStorage("backup.completed-pages", () => db.prepare("SELECT table_name,ordinal,cursor_before,cursor_after,row_count,bytes,sha256,final FROM backup_pages WHERE owner_id=? AND backup_id=? ORDER BY table_name,ordinal LIMIT ?").bind(owner.userId, id, backupPolicy.maximumPages + 1).all<StoredPage>()),
  ]);
  if (completion === null || result.results.length > backupPolicy.maximumPages) throw backupFailure("incomplete-manifest", "manifest.receipts");
  const pages: readonly BackupPageEntry[] = result.results.map(backupPageReceipt);
  const objects: readonly BackupObjectEntry[] = await readObjectEntries(db, run, new TextEncoder().encode(JSON.stringify(pages)).byteLength);
  const manifest: BackupManifest = manifestFromReceipts(run, pages, objects, completion.completed_at);
  if (await backupTextHash(JSON.stringify(manifest)) !== completion.sha256) throw backupFailure("incomplete-manifest", "manifest.sha256");
  return manifest;
}

/** 모든 파일의 수신 확인과 현재 D1 기준을 같은 최종 트랜잭션에서 검사합니다. */
export async function completeBackup(db: AtomicDatabase, owner: SiteIdentity, id: string, now: number): Promise<BackupManifest> {
  timestamp.parse(now);
  const previous: BackupRun = await readBackupRun(db, owner, id);
  if (previous.state === "complete") return readCompletedBackup(db, owner, id);
  const database = await finishBackupDatabase(db, owner, id);
  const run: BackupRun = database.run;
  const required: number = await requireBackupObjectSet(db, run);
  const objects = await readObjectEntries(db, run, new TextEncoder().encode(JSON.stringify(database.pages)).byteLength);
  if (objects.length !== required) throw backupFailure("incomplete-download", "objects.count");
  const pending = await snapshotRead(db, run, db.prepare("SELECT count(*) AS n FROM backup_pages WHERE owner_id=? AND backup_id=? AND acknowledged_at IS NULL").bind(owner.userId, id), "backup.page-acknowledgements");
  if (z.object({ n: z.literal(0) }).safeParse(pending.results[0]).success === false) throw backupFailure("incomplete-download", "pages.acknowledgement");
  const manifest: BackupManifest = manifestFromReceipts(run, database.pages, objects, now);
  const sha256: string = await backupTextHash(JSON.stringify(manifest)); const check: string = crypto.randomUUID();
  try { await runBackupSnapshotBatch(db, run, [
    db.prepare("INSERT INTO backup_completions(owner_id,backup_id,completed_at,sha256) VALUES (?,?,?,?) ON CONFLICT(owner_id,backup_id) DO NOTHING").bind(owner.userId, id, now, sha256),
    db.prepare("UPDATE backup_runs SET state='complete' WHERE owner_id=? AND id=? AND state='database-ready' AND NOT EXISTS(SELECT 1 FROM backup_pages WHERE owner_id=? AND backup_id=? AND acknowledged_at IS NULL) AND (SELECT count(*) FROM backup_pages WHERE owner_id=? AND backup_id=?)=? AND (SELECT count(*) FROM backup_objects WHERE owner_id=? AND backup_id=? AND acknowledged_at IS NOT NULL)=?").bind(owner.userId, id, owner.userId, id, owner.userId, id, database.pages.length, owner.userId, id, required),
    backupGuard(db, check, "EXISTS(SELECT 1 FROM backup_runs b JOIN backup_completions c ON c.owner_id=b.owner_id AND c.backup_id=b.id WHERE b.owner_id=? AND b.id=? AND b.state='complete' AND c.completed_at=? AND c.sha256=?)", [owner.userId, id, now, sha256]),
    db.prepare("DELETE FROM backup_checks WHERE id=?").bind(check),
  ], "backup.complete"); }
  catch (error: unknown) {
    let after: BackupRun;
    try { after = await readBackupRun(db, owner, id); }
    catch (lookupError: unknown) { throw domainFailure("result_unknown", "backup.complete", new AggregateError([error, lookupError], "백업 완료 저장 결과 조회도 실패했습니다.")); }
    if (after.state === "complete") return readCompletedBackup(db, owner, id);
    throw error;
  }
  return manifest;
}
