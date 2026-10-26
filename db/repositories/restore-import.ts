import { z } from "zod";
import { backupCatalog } from "../../lib/backup/catalog.ts";
import { backupFailure, backupTable } from "../../lib/backup/contracts.ts";
import type { BackupRow, BackupPage, BackupManifest } from "../../lib/backup/contracts.ts";
import { restorePageOrder } from "../../lib/backup/restore-order.ts";
import { projectRestoreRow, restoreUploadReference } from "../../lib/backup/restore-projection.ts";
import type { RestoreObjectMapping } from "../../lib/backup/restore-projection.ts";
import { requireRestoredOriginalIdentity } from "../../lib/backup/restore-original.ts";
import { contentHash, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import type { StorageContext } from "../../lib/backup/storage-identity.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase } from "./atomic.ts";
import { backupGuard } from "./backup.ts";
import { readRestoredOriginal } from "./restore-originals.ts";
import { readReceivedRestorePage, readRestoreManifest } from "./restore-receiving.ts";

const progressSchema = z.object({ run_id: z.string(), manifest_sha256: z.string(), expected_pages: z.number().int().positive(), loaded_pages: z.number().int().nonnegative(), started_at: timestamp }).strict();
export type RestoreImportProgress = Readonly<z.infer<typeof progressSchema>>;
const receiptSchema = z.object({ run_id: z.string(), path: z.string(), sequence: z.number().int().nonnegative(), source_sha256: z.string(), projected_sha256: z.string(), row_count: z.number().int().nonnegative(), loaded_at: timestamp }).strict();
export type RestoreImportReceipt = Readonly<z.infer<typeof receiptSchema>>;
type Archive = Awaited<ReturnType<typeof readRestoreManifest>>;
async function progress(db: AtomicDatabase, id: string): Promise<RestoreImportProgress | null> {
  const row = await db.prepare("SELECT * FROM restore_imports WHERE run_id=?").bind(id).first<RestoreImportProgress>(); return row === null ? null : progressSchema.parse(row);
}
async function savedReceipt(db: AtomicDatabase, id: string, path: string): Promise<RestoreImportReceipt | null> {
  const row = await db.prepare("SELECT * FROM restore_import_pages WHERE run_id=? AND path=?").bind(id, path).first<RestoreImportReceipt>(); return row === null ? null : receiptSchema.parse(row);
}
function requireProgress(value: RestoreImportProgress | null, archive: Archive): RestoreImportProgress {
  if (value === null || value.manifest_sha256 !== archive.receipt.manifestSha256 || value.expected_pages !== archive.document.manifest.pages.length) throw backupFailure("export-conflict", "restore.import-basis"); return value;
}
/** 원본과 페이지 수신이 전부 완료된 빈 대상만 적재 단계로 전환합니다. 학습 접근은 계속 격리합니다. */
export async function beginRestoreImport(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, now: number): Promise<RestoreImportProgress> {
  timestamp.parse(now); const archive = await readRestoreManifest(db, bucket, context, owner, id);
  return readStorage("restore.import-start", async () => {
    const existing = await progress(db, id); if (existing !== null) return requireProgress(existing, archive);
    if (archive.run.state !== "receiving") throw backupFailure("export-conflict", "restore.import-state");
    const manifest = archive.document.manifest; const guard: string = crypto.randomUUID();
    await db.batch([
      backupGuard(db, guard, "EXISTS(SELECT 1 FROM restore_runs WHERE id=? AND state='receiving') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes) AND (SELECT count(*) FROM restore_page_receipts WHERE run_id=?)=? AND (SELECT count(*) FROM restore_originals WHERE run_id=? AND state='verified')=? AND NOT EXISTS(SELECT 1 FROM restore_originals WHERE run_id=? AND state<>'verified')", [id, id, manifest.pages.length, id, manifest.objects.length, id]),
      backupGuard(db, `${guard}-empty`, backupCatalog.map(table => `NOT EXISTS(SELECT 1 FROM "${table.name}")`).join(" AND "), []),
      db.prepare("INSERT INTO restore_imports(run_id,manifest_sha256,expected_pages,loaded_pages,started_at) VALUES (?,?,?,0,?)").bind(id, archive.receipt.manifestSha256, manifest.pages.length, now),
      db.prepare("UPDATE restore_runs SET state='verifying' WHERE id=? AND state='receiving'").bind(id),
      backupGuard(db, `${guard}-state`, "EXISTS(SELECT 1 FROM restore_runs WHERE id=? AND state='verifying')", [id]),
      db.prepare("DELETE FROM backup_checks WHERE id IN (?,?,?)").bind(guard, `${guard}-empty`, `${guard}-state`),
    ]);
    return requireProgress(await progress(db, id), archive);
  });
}
async function objectMapping(db: AtomicDatabase, bucket: R2Bucket, id: string, manifest: BackupManifest, uploadId: string): Promise<RestoreObjectMapping | null> {
  const ordinal: number = manifest.objects.findIndex(entry => entry.uploadId === uploadId); if (ordinal === -1) return null;
  const raw = await readRestoredOriginal(db, id, manifest, ordinal); const plan = raw.source;
  const object = await bucket.head(plan.entry.objectKey); if (object === null) throw backupFailure("object-changed", "restore.import-original-missing");
  requireRestoredOriginalIdentity(object, id, plan);
  if (object.version !== raw.objectVersion || object.etag !== raw.etag) throw backupFailure("object-changed", "restore.import-original-version");
  return { entry: plan.entry, objectVersion: raw.objectVersion, etag: raw.etag };
}
async function projectedRows(db: AtomicDatabase, bucket: R2Bucket, archive: Archive, page: BackupPage, owner: SiteIdentity): Promise<readonly BackupRow[]> {
  const mappings = new Map<string, RestoreObjectMapping | null>();
  for (const row of page.rows) { const uploadId = restoreUploadReference(page.table, row); if (uploadId !== null && !mappings.has(uploadId)) mappings.set(uploadId, await objectMapping(db, bucket, archive.run.id, archive.document.manifest, uploadId)); }
  return page.rows.map(row => projectRestoreRow(page.table, row, page.basis.ownerId, owner.userId, mappings.get(restoreUploadReference(page.table, row) ?? "") ?? null));
}
function rowPredicate(page: BackupPage): string { return backupTable(page.table).columns.map(column => `"${column.name}" IS ?`).join(" AND "); }
function rowValues(page: BackupPage, row: BackupRow): readonly (string | number | null)[] { return backupTable(page.table).columns.map(column => row[column.name]); }
async function verifyReplay(db: AtomicDatabase, page: BackupPage, rows: readonly BackupRow[], receipt: RestoreImportReceipt, expected: RestoreImportReceipt): Promise<RestoreImportReceipt> {
  if (receipt.sequence !== expected.sequence || receipt.source_sha256 !== expected.source_sha256 || receipt.projected_sha256 !== expected.projected_sha256 || receipt.row_count !== expected.row_count) throw backupFailure("export-conflict", "restore.import-replay-receipt");
  for (const row of rows) if (await db.prepare(`SELECT 1 AS matched FROM "${page.table}" WHERE ${rowPredicate(page)}`).bind(...rowValues(page, row)).first<number>("matched") !== 1) throw backupFailure("export-conflict", "restore.import-replay-row");
  return receipt;
}
async function commitPage(db: AtomicDatabase, archive: Archive, page: BackupPage, rows: readonly BackupRow[], owner: SiteIdentity, expected: RestoreImportReceipt): Promise<RestoreImportReceipt> {
  const prior = await savedReceipt(db, expected.run_id, expected.path); if (prior !== null) return verifyReplay(db, page, rows, prior, expected);
  const guard: string = crypto.randomUUID(); const table = backupTable(page.table); const ids = [guard, `${guard}-progress`, `${guard}-scope`, ...rows.map((_, index) => `${guard}-row-${index}`)];
  const statements: D1PreparedStatement[] = [
    backupGuard(db, guard, "EXISTS(SELECT 1 FROM restore_runs r JOIN restore_imports i ON i.run_id=r.id WHERE r.id=? AND r.owner_id=? AND r.state='verifying' AND i.manifest_sha256=? AND i.loaded_pages=?) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes)", [archive.run.id, owner.userId, archive.receipt.manifestSha256, expected.sequence]),
    db.prepare("INSERT INTO restore_import_scopes(slot,run_id,owner_id,table_name,path,source_sha256) VALUES (1,?,?,?,?,?)").bind(archive.run.id, owner.userId, page.table, expected.path, expected.source_sha256),
    ...rows.flatMap((row, index) => [db.prepare(`INSERT INTO "${table.name}"(${table.columns.map(column => `"${column.name}"`).join(",")}) VALUES (${table.columns.map(() => "?").join(",")})`).bind(...rowValues(page, row)), backupGuard(db, `${guard}-row-${index}`, `EXISTS(SELECT 1 FROM "${table.name}" WHERE ${rowPredicate(page)})`, rowValues(page, row))]),
    db.prepare("INSERT INTO restore_import_pages(run_id,path,sequence,source_sha256,projected_sha256,row_count,loaded_at) VALUES (?,?,?,?,?,?,?)").bind(expected.run_id, expected.path, expected.sequence, expected.source_sha256, expected.projected_sha256, expected.row_count, expected.loaded_at),
    db.prepare("UPDATE restore_imports SET loaded_pages=loaded_pages+1 WHERE run_id=? AND loaded_pages=?").bind(expected.run_id, expected.sequence),
    backupGuard(db, `${guard}-progress`, "EXISTS(SELECT 1 FROM restore_imports WHERE run_id=? AND loaded_pages=?)", [expected.run_id, expected.sequence + 1]),
    db.prepare("DELETE FROM restore_import_scopes WHERE slot=1 AND run_id=?").bind(expected.run_id),
    backupGuard(db, `${guard}-scope`, "NOT EXISTS(SELECT 1 FROM restore_import_scopes)", []),
    db.prepare(`DELETE FROM backup_checks WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids),
  ];
  try { await db.batch(statements); }
  catch (error: unknown) {
    const committed = await savedReceipt(db, expected.run_id, expected.path);
    if (committed === null) throw error;
    console.warn({ event: "restore_import_response_reconciled", runId: expected.run_id, sequence: expected.sequence });
    return verifyReplay(db, page, rows, committed, expected);
  }
  const saved = await savedReceipt(db, expected.run_id, expected.path); if (saved === null) throw backupFailure("missing-export", "restore.import-commit"); return verifyReplay(db, page, rows, saved, expected);
}
/** 수신한 원문을 다시 검증한 뒤 고정 순서의 한 페이지를 원자적으로 적재합니다. 요청 본문의 행이나 SQL을 받지 않습니다. */
export async function importRestorePage(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, path: string, now: number): Promise<RestoreImportReceipt> {
  timestamp.parse(now); const archive = await readRestoreManifest(db, bucket, context, owner, id);
  if (archive.run.state !== "verifying") throw backupFailure("export-conflict", "restore.import-state");
  const order = restorePageOrder(archive.document.manifest); const sequence: number = order.findIndex(entry => entry.path === path);
  if (sequence === -1) throw backupFailure("invalid-page", "restore.import-path");
  const current = requireProgress(await readStorage("restore.import-progress", () => progress(db, id)), archive);
  if (current.loaded_pages < sequence) throw backupFailure("export-conflict", "restore.import-page-order");
  const page = await readReceivedRestorePage(db, bucket, archive, path); const rows = await readStorage("restore.import-project", () => projectedRows(db, bucket, archive, page, owner));
  const expected: RestoreImportReceipt = { run_id: id, path, sequence, source_sha256: order[sequence].sha256, projected_sha256: await contentHash(rows), row_count: rows.length, loaded_at: now };
  return readStorage("restore.import-page", () => commitPage(db, archive, page, rows, owner, expected));
}
