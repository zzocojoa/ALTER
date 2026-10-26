import { z } from "zod";
import { canonicalJson, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { backupFailure, backupPolicy } from "../../lib/backup/contracts.ts";
import { restoreAuthorityFailure } from "../../lib/backup/restore-authority.ts";
import { restoreDocumentFact, restoreDocumentKey, validateRestoreManifestDocument, validateRestorePageDocument } from "../../lib/backup/restore-document.ts";
import type { BackupPage } from "../../lib/backup/contracts.ts";
import type { RestoreDocumentFact, RestoreManifestDocument } from "../../lib/backup/restore-document.ts";
import { readStorageMarker, requireEmptyRestoreBucket } from "../../lib/backup/storage-identity.ts";
import type { StorageContext } from "../../lib/backup/storage-identity.ts";
import { createPrivateObject, readPrivateObject } from "../../lib/r2-access.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase } from "./atomic.ts";
import { backupGuard } from "./backup.ts";
import { readRestoreRun } from "./restore-run.ts";
import type { RestoreRun } from "./restore-run.ts";

const archiveRow = z.object({ run_id: z.string(), manifest_key: z.string(), manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/), manifest_bytes: z.number().int().positive(), reserved_bytes: z.number().int().positive(), state: z.enum(["reserved", "ready"]), object_version: z.string().nullable(), created_at: timestamp, ready_at: timestamp.nullable() }).strict();
type ArchiveRow = Readonly<z.infer<typeof archiveRow>>;
const pageReceipt = z.object({ run_id: z.string(), path: z.string(), object_key: z.string(), object_version: z.string().min(1), bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), received_at: timestamp }).strict();
export type RestorePageReceipt = Readonly<z.infer<typeof pageReceipt>>;
export type RestoreArchiveReceipt = Readonly<{ runId: string; state: "ready"; manifestSha256: string; manifestBytes: number; reservedBytes: number; objectVersion: string }>;
function readyReceipt(row: ArchiveRow): RestoreArchiveReceipt {
  if (row.state !== "ready" || row.object_version === null) throw backupFailure("incomplete-export", "restore.manifest-not-ready");
  return { runId: row.run_id, state: "ready", manifestSha256: row.manifest_sha256, manifestBytes: row.manifest_bytes, reservedBytes: row.reserved_bytes, objectVersion: row.object_version };
}
function requireReceiving(run: RestoreRun): void { if (run.state !== "receiving") throw restoreAuthorityFailure("wrong-backup", "run-not-receiving"); }
function runGuard(db: AtomicDatabase, id: string, run: RestoreRun): D1PreparedStatement {
  return backupGuard(db, id, "EXISTS(SELECT 1 FROM restore_runs WHERE id=? AND state='receiving' AND authorization=?)", [run.id, canonicalJson(run.authorization)]);
}
async function storedArchive(db: AtomicDatabase, id: string): Promise<ArchiveRow | null> {
  const row = await readStorage("restore.archive-read", () => db.prepare("SELECT run_id,manifest_key,manifest_sha256,manifest_bytes,reserved_bytes,state,object_version,created_at,ready_at FROM restore_archives WHERE run_id=?").bind(id).first<ArchiveRow>());
  return row === null ? null : archiveRow.parse(row);
}
async function storedPage(db: AtomicDatabase, id: string, path: string): Promise<RestorePageReceipt | null> {
  const row = await readStorage("restore.page-read", () => db.prepare("SELECT run_id,path,object_key,object_version,bytes,sha256,received_at FROM restore_page_receipts WHERE run_id=? AND path=?").bind(id, path).first<RestorePageReceipt>());
  return row === null ? null : pageReceipt.parse(row);
}
/** R2 문서는 선언 크기를 먼저 제한하고 해시 검사 뒤에도 버전 교체 여부를 확인합니다. */
async function readDocument(bucket: R2Bucket, key: string, expected: RestoreDocumentFact, maximum: number): Promise<Readonly<{ text: string; version: string }>> {
  const object = await readPrivateObject(bucket, key);
  if (object === null) throw backupFailure("invalid-object", "restore.document-missing");
  if (object.size !== expected.bytes || object.size < 1 || object.size > maximum) { await object.body.cancel(); throw backupFailure("invalid-object", "restore.document-size"); }
  const text: string = await object.text(); const fact = await restoreDocumentFact(text);
  if (fact.bytes !== expected.bytes || fact.sha256 !== expected.sha256) throw backupFailure("invalid-object", "restore.document-checksum");
  const current = await readStorage("restore.document-head", () => bucket.head(key));
  if (current === null || current.version !== object.version || current.size !== object.size) throw backupFailure("object-changed", "restore.document-version");
  return { text, version: object.version };
}
async function createDocument(bucket: R2Bucket, key: string, text: string, fact: RestoreDocumentFact, maximum: number): Promise<string> {
  const bytes: Uint8Array<ArrayBuffer> = new TextEncoder().encode(text);
  if (bytes.byteLength > maximum || bytes.byteLength !== fact.bytes) throw backupFailure("page-too-large", "restore.document-create");
  await createPrivateObject(bucket, key, bytes.buffer);
  return (await readDocument(bucket, key, fact, maximum)).version;
}
function requireArchive(row: ArchiveRow, run: RestoreRun, document: RestoreManifestDocument): void {
  if (row.run_id !== run.id || row.manifest_key !== restoreDocumentKey(run.id, "manifest.json") || row.manifest_bytes !== document.fact.bytes || row.manifest_sha256 !== document.fact.sha256 || row.reserved_bytes !== document.reservedBytes) throw backupFailure("export-conflict", "restore.manifest-reservation");
}
/** 전체 파일 용량을 먼저 예약합니다. R2나 D1 응답이 유실되면 기존 예약과 원문을 대조해서만 재개합니다. */
export async function receiveRestoreManifest(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, text: string, now: number): Promise<RestoreArchiveReceipt> {
  timestamp.parse(now); const run = await readRestoreRun(db, bucket, context, owner, id); requireReceiving(run);
  const document = await validateRestoreManifestDocument(text, run.authorization);
  if (await storedArchive(db, id) === null) await requireEmptyRestoreBucket(bucket, await readStorageMarker(bucket));
  const key: string = restoreDocumentKey(id, "manifest.json"); const guard: string = crypto.randomUUID();
  await readStorage("restore.archive-reserve", () => db.batch([
    runGuard(db, guard, run),
    db.prepare("INSERT INTO restore_archives(run_id,manifest_key,manifest_sha256,manifest_bytes,reserved_bytes,state,created_at) VALUES (?,?,?,?,?,'reserved',?) ON CONFLICT(run_id) DO NOTHING").bind(id, key, document.fact.sha256, document.fact.bytes, document.reservedBytes, now),
    db.prepare("DELETE FROM backup_checks WHERE id=?").bind(guard),
  ]));
  const row = await storedArchive(db, id); if (row === null) throw backupFailure("missing-export", "restore.manifest-reservation"); requireArchive(row, run, document);
  if (row.state === "ready") {
    const saved = await readDocument(bucket, key, document.fact, backupPolicy.maximumManifestBytes);
    if (saved.version !== row.object_version) throw backupFailure("object-changed", "restore.manifest-version"); return readyReceipt(row);
  }
  const objectVersion: string = await createDocument(bucket, key, text, document.fact, backupPolicy.maximumManifestBytes);
  await readStorage("restore.archive-confirm", () => db.batch([
    runGuard(db, guard, run),
    db.prepare("UPDATE restore_archives SET state='ready',object_version=?,ready_at=? WHERE run_id=? AND state='reserved' AND manifest_sha256=? AND reserved_bytes=?").bind(objectVersion, now, id, document.fact.sha256, document.reservedBytes),
    backupGuard(db, `${guard}-ready`, "EXISTS(SELECT 1 FROM restore_archives WHERE run_id=? AND state='ready' AND object_version=? AND manifest_sha256=? AND manifest_bytes=? AND reserved_bytes=?)", [id, objectVersion, document.fact.sha256, document.fact.bytes, document.reservedBytes]),
    db.prepare("DELETE FROM backup_checks WHERE id IN (?,?)").bind(guard, `${guard}-ready`),
  ]));
  const confirmed = await storedArchive(db, id); if (confirmed === null) throw backupFailure("missing-export", "restore.manifest-confirmation"); return readyReceipt(confirmed);
}
export async function readRestoreManifest(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string): Promise<Readonly<{ run: RestoreRun; document: RestoreManifestDocument; receipt: RestoreArchiveReceipt }>> {
  const run = await readRestoreRun(db, bucket, context, owner, id); const row = await storedArchive(db, id);
  if (row === null) throw backupFailure("missing-export", "restore.manifest"); const receipt = readyReceipt(row);
  const saved = await readDocument(bucket, row.manifest_key, { bytes: row.manifest_bytes, sha256: row.manifest_sha256 }, backupPolicy.maximumManifestBytes);
  if (saved.version !== row.object_version) throw backupFailure("object-changed", "restore.manifest-version");
  const document = await validateRestoreManifestDocument(saved.text, run.authorization); requireArchive(row, run, document); return { run, document, receipt };
}
/** 수신은 검증된 중간 문서와 영수증만 남깁니다. 학습 기록 적재·실행 활성화와 구분합니다. */
export async function receiveRestorePage(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, path: string, text: string, now: number): Promise<RestorePageReceipt> {
  timestamp.parse(now); const archive = await readRestoreManifest(db, bucket, context, owner, id); requireReceiving(archive.run);
  const validated = await validateRestorePageDocument(text, archive.document.manifest, path); const key: string = restoreDocumentKey(id, path); const prior = await storedPage(db, id, path);
  if (prior !== null) {
    const object = await readDocument(bucket, key, validated.fact, backupPolicy.maximumPageBytes);
    if (prior.object_key !== key || prior.bytes !== validated.fact.bytes || prior.sha256 !== validated.fact.sha256 || prior.object_version !== object.version) throw backupFailure("object-changed", "restore.page-receipt"); return prior;
  }
  const version: string = await createDocument(bucket, key, text, validated.fact, backupPolicy.maximumPageBytes); const guard: string = crypto.randomUUID();
  await readStorage("restore.page-confirm", () => db.batch([
    runGuard(db, guard, archive.run),
    backupGuard(db, `${guard}-archive`, "EXISTS(SELECT 1 FROM restore_archives WHERE run_id=? AND state='ready' AND manifest_sha256=? AND object_version=?)", [id, archive.receipt.manifestSha256, archive.receipt.objectVersion]),
    db.prepare("INSERT INTO restore_page_receipts(run_id,path,object_key,object_version,bytes,sha256,received_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(run_id,path) DO NOTHING").bind(id, path, key, version, validated.fact.bytes, validated.fact.sha256, now),
    backupGuard(db, `${guard}-page`, "EXISTS(SELECT 1 FROM restore_page_receipts WHERE run_id=? AND path=? AND object_key=? AND object_version=? AND bytes=? AND sha256=?)", [id, path, key, version, validated.fact.bytes, validated.fact.sha256]),
    db.prepare("DELETE FROM backup_checks WHERE id IN (?,?,?)").bind(guard, `${guard}-archive`, `${guard}-page`),
  ]));
  const saved = await storedPage(db, id, path); if (saved === null) throw backupFailure("missing-export", "restore.page-confirmation"); return saved;
}

/** 개별 원본의 근거 페이지 두 개만 읽도록 수신 페이지를 직접 조회합니다. 전체 백업을 메모리에 펼치지 않습니다. */
export async function readReceivedRestorePage(db: AtomicDatabase, bucket: R2Bucket, archive: Awaited<ReturnType<typeof readRestoreManifest>>, path: string): Promise<BackupPage> {
  const receipt = await storedPage(db, archive.run.id, path);
  const entry = archive.document.manifest.pages.find(item => item.path === path);
  if (receipt === null || entry === undefined) throw backupFailure("incomplete-download", "restore.source-page");
  if (receipt.object_key !== restoreDocumentKey(archive.run.id, path) || receipt.bytes !== entry.bytes || receipt.sha256 !== entry.sha256) throw backupFailure("invalid-page", "restore.source-page-receipt");
  const stored = await readDocument(bucket, receipt.object_key, entry, backupPolicy.maximumPageBytes);
  if (stored.version !== receipt.object_version) throw backupFailure("object-changed", "restore.source-page-version");
  return (await validateRestorePageDocument(stored.text, archive.document.manifest, path)).page;
}
