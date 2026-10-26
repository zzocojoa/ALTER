import { z } from "zod";
import { backupFailure, backupObjectEntry, backupObjectPath, backupPolicy } from "../../lib/backup/contracts.ts";
import type { BackupObjectEntry } from "../../lib/backup/contracts.ts";
import { timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { backupGuard, readBackupRun, requireBackupCurrent, runBackupSnapshotBatch, snapshotRead } from "./backup.ts";
import type { BackupRun } from "./backup.ts";
import { materialTransferFromRow } from "./material-transfers.ts";
import type { StoredTransfer, TransferRow } from "./material-transfers.ts";
import type { AtomicDatabase, SqlValue } from "./atomic.ts";

export type BackupSourceObject = Readonly<{ ordinal: number; entry: BackupObjectEntry; transfer: StoredTransfer }>;
export type BackupObjectList = Readonly<{ entries: readonly BackupObjectEntry[]; count: number; nextOffset: number | null }>;
const ordinalSchema = z.number().int().min(0).max(backupPolicy.maximumObjects - 1);
const registeredFrom = "material_transfers t JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id JOIN materials m ON m.owner_id=t.owner_id AND m.id=t.material_id JOIN material_files f ON f.owner_id=t.owner_id AND f.transfer_id=t.id AND f.material_id=t.material_id";

/** 등록됐거나 삭제가 확인된 업로드만 완전한 백업으로 묶습니다. 미확정 전송은 추정 복구하지 않습니다. */
export async function requireBackupObjectSet(db: AtomicDatabase, run: BackupRun): Promise<number> {
  const rows = await snapshotRead(db, run, db.prepare(`SELECT (SELECT count(*) FROM uploads u LEFT JOIN material_transfers t ON t.owner_id=u.owner_id AND t.id=u.id
    WHERE u.owner_id=? AND CASE
      WHEN t.state='registered' AND u.state='verified' AND EXISTS(SELECT 1 FROM material_files f WHERE f.owner_id=u.owner_id AND f.transfer_id=u.id AND f.material_id=u.material_id) THEN 0
      WHEN t.state='discarded' AND u.state='missing' AND NOT EXISTS(SELECT 1 FROM material_files f WHERE f.owner_id=u.owner_id AND f.transfer_id=u.id) THEN 0
      ELSE 1 END=1) AS unsettled,
    (SELECT count(*) FROM material_files WHERE owner_id=?) AS required`).bind(run.basis.ownerId, run.basis.ownerId), "backup.object-set");
  const result = z.object({ unsettled: z.number().int().nonnegative(), required: z.number().int().nonnegative().max(backupPolicy.maximumObjects) }).parse(rows.results[0]);
  if (result.unsettled !== 0) throw backupFailure("unsettled-upload", "objects.upload-state");
  return result.required;
}
function sourceObject(row: TransferRow & { expected_hash: string; verified_hash: string; expected_bytes: number }, ordinal: number): BackupSourceObject {
  const transfer: StoredTransfer = materialTransferFromRow(row);
  const object = transfer.snapshot.object;
  if (transfer.snapshot.state !== "registered" || object === null || transfer.snapshot.validation === null || object.bytes !== row.expected_bytes || object.sha256 !== row.expected_hash || object.sha256 !== row.verified_hash) throw backupFailure("invalid-object", "objects.source");
  // uploadId는 uploads의 기본 키이며 전송용 upload_id와 구분합니다.
  const entry: BackupObjectEntry = backupObjectEntry.parse({ materialId: transfer.materialId, uploadId: transfer.id, objectKey: transfer.objectKey, path: backupObjectPath(ordinal), bytes: object.bytes, objectVersion: object.objectVersion, etag: object.etag, sha256: object.sha256 });
  return { ordinal, entry, transfer };
}
async function readSourceObjects(db: AtomicDatabase, run: BackupRun, offset: number, limit: number): Promise<readonly BackupSourceObject[]> {
  const result = await snapshotRead(db, run, db.prepare(`SELECT t.*,u.upload_id,u.object_key,u.recovery_at,m.course_id,u.expected_hash,u.verified_hash,u.bytes AS expected_bytes FROM ${registeredFrom} WHERE t.owner_id=? AND t.state='registered' AND u.state='verified' ORDER BY u.rowid LIMIT ? OFFSET ?`).bind(run.basis.ownerId, limit, offset), "backup.object-sources");
  return (result.results as (TransferRow & { expected_hash: string; verified_hash: string; expected_bytes: number })[]).map((row, index) => sourceObject(row, offset + index));
}
export async function listBackupObjects(db: AtomicDatabase, owner: SiteIdentity, id: string, offset: number): Promise<BackupObjectList> {
  ordinalSchema.parse(offset);
  const run: BackupRun = requireBackupCurrent(await readBackupRun(db, owner, id));
  const count: number = await requireBackupObjectSet(db, run);
  const sources = await readSourceObjects(db, run, offset, 16);
  return { entries: sources.map(source => source.entry), count, nextOffset: offset + sources.length < count ? offset + sources.length : null };
}
export async function readBackupSourceObject(db: AtomicDatabase, run: BackupRun, ordinal: number): Promise<BackupSourceObject> {
  ordinalSchema.parse(ordinal);
  if (run.state !== "database-ready") throw backupFailure("incomplete-export", "objects.database-pages");
  await requireBackupObjectSet(db, run);
  const sources = await readSourceObjects(db, run, ordinal, 1);
  if (sources.length !== 1) throw backupFailure("invalid-object", "objects.ordinal");
  return sources[0];
}
export async function resetBackupObjectDownload(db: AtomicDatabase, run: BackupRun, ordinal: number): Promise<void> {
  await runBackupSnapshotBatch(db, run, [db.prepare("DELETE FROM backup_objects WHERE owner_id=? AND backup_id=? AND ordinal=?").bind(run.basis.ownerId, run.id, ordinal)], "backup.object-reset");
}
export async function saveBackupObjectProof(db: AtomicDatabase, run: BackupRun, source: BackupSourceObject, now: number): Promise<void> {
  timestamp.parse(now); const entry: BackupObjectEntry = backupObjectEntry.parse(source.entry); const check: string = crypto.randomUUID();
  const identity: readonly SqlValue[] = [run.basis.ownerId, run.id, source.ordinal];
  const values: readonly SqlValue[] = [...identity, entry.materialId, entry.uploadId, entry.objectKey, entry.bytes, entry.objectVersion, entry.etag, entry.sha256];
  await runBackupSnapshotBatch(db, run, [
    db.prepare("INSERT INTO backup_objects(owner_id,backup_id,ordinal,material_id,upload_id,object_key,bytes,object_version,etag,sha256,verified_at,acknowledged_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(owner_id,backup_id,ordinal) DO NOTHING").bind(...values, now),
    backupGuard(db, check, "EXISTS(SELECT 1 FROM backup_objects WHERE owner_id=? AND backup_id=? AND ordinal=? AND material_id=? AND upload_id=? AND object_key=? AND bytes=? AND object_version=? AND etag=? AND sha256=?)", values),
    db.prepare("DELETE FROM backup_checks WHERE id=?").bind(check),
  ], "backup.object-verified");
}
export async function acknowledgeBackupObject(db: AtomicDatabase, owner: SiteIdentity, id: string, ordinal: number, checksum: string, bytes: number, now: number): Promise<void> {
  ordinalSchema.parse(ordinal); z.string().regex(/^[a-f0-9]{64}$/).parse(checksum); z.number().int().positive().max(backupPolicy.maximumObjectBytes).parse(bytes); timestamp.parse(now);
  const run: BackupRun = requireBackupCurrent(await readBackupRun(db, owner, id)); const check: string = crypto.randomUUID();
  await runBackupSnapshotBatch(db, run, [
    db.prepare("UPDATE backup_objects SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE owner_id=? AND backup_id=? AND ordinal=? AND sha256=? AND bytes=? AND verified_at<=?").bind(now, owner.userId, id, ordinal, checksum, bytes, now),
    backupGuard(db, check, "EXISTS(SELECT 1 FROM backup_objects WHERE owner_id=? AND backup_id=? AND ordinal=? AND sha256=? AND bytes=? AND acknowledged_at IS NOT NULL)", [owner.userId, id, ordinal, checksum, bytes]),
    db.prepare("DELETE FROM backup_checks WHERE id=?").bind(check),
  ], "backup.object-acknowledge");
}
