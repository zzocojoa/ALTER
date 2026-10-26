import { z } from "zod";
import { backupCatalog } from "../../lib/backup/catalog.ts";
import { backupFailure } from "../../lib/backup/contracts.ts";
import type { BackupPage } from "../../lib/backup/contracts.ts";
import { runtimeReferences } from "../../lib/backup/runtime-references.ts";
import { verifyRestoredOriginal } from "../../lib/backup/restore-original-stream.ts";
import type { StorageContext } from "../../lib/backup/storage-identity.ts";
import { timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase } from "./atomic.ts";
import { backupGuard } from "./backup.ts";
import { importRestorePage } from "./restore-import.ts";
import { readRestoredOriginal } from "./restore-originals.ts";
import { readReceivedRestorePage, readRestoreManifest } from "./restore-receiving.ts";

const verificationSchema = z.object({ run_id: z.string(), manifest_sha256: z.string(), revision: z.number().int().nonnegative().safe(), page_count: z.number().int().positive(), object_count: z.number().int().nonnegative(), row_count: z.number().int().nonnegative().safe(), started_at: timestamp, completed_at: timestamp.nullable() }).strict();
export type RestoreVerification = Readonly<z.infer<typeof verificationSchema>>;
const itemSchema = z.object({ run_id: z.string(), path: z.string(), kind: z.enum(["page", "original"]), sha256: z.string(), projected_sha256: z.string().nullable(), object_version: z.string().nullable(), verified_at: timestamp }).strict();
export type RestoreVerificationItem = Readonly<z.infer<typeof itemSchema>>;
type Archive = Awaited<ReturnType<typeof readRestoreManifest>>;
async function storedVerification(db: AtomicDatabase, id: string): Promise<RestoreVerification | null> {
  const row = await db.prepare("SELECT * FROM restore_verifications WHERE run_id=?").bind(id).first<RestoreVerification>(); return row === null ? null : verificationSchema.parse(row);
}
async function storedItem(db: AtomicDatabase, id: string, path: string): Promise<RestoreVerificationItem | null> {
  const row = await db.prepare("SELECT * FROM restore_verification_items WHERE run_id=? AND path=?").bind(id, path).first<RestoreVerificationItem>(); return row === null ? null : itemSchema.parse(row);
}
async function revision(db: AtomicDatabase, owner: SiteIdentity): Promise<number> {
  const value = await db.prepare("SELECT COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=?),0) AS revision").bind(owner.userId).first<number>("revision"); return z.number().int().nonnegative().safe().parse(value);
}
function requireBasis(value: RestoreVerification | null, archive: Archive): RestoreVerification {
  if (value === null || value.manifest_sha256 !== archive.receipt.manifestSha256 || value.page_count !== archive.document.manifest.pages.length || value.object_count !== archive.document.manifest.objects.length || value.row_count !== archive.document.manifest.counts.reduce((sum, item) => sum + item.rows, 0)) throw backupFailure("export-conflict", "restore.verification-basis"); return value;
}
async function currentVerification(db: AtomicDatabase, owner: SiteIdentity, archive: Archive): Promise<RestoreVerification> {
  const value = requireBasis(await storedVerification(db, archive.run.id), archive);
  if (value.revision !== await revision(db, owner)) throw backupFailure("export-conflict", "restore.verification-data-changed"); return value;
}
function snapshotGuard(db: AtomicDatabase, guard: string, verification: RestoreVerification, owner: SiteIdentity): D1PreparedStatement {
  return backupGuard(db, guard, "EXISTS(SELECT 1 FROM restore_runs r JOIN restore_verifications v ON v.run_id=r.id JOIN restore_imports i ON i.run_id=r.id WHERE r.id=? AND r.owner_id=? AND r.state='verifying' AND v.completed_at IS NULL AND v.revision=? AND v.manifest_sha256=? AND i.loaded_pages=i.expected_pages AND v.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=r.owner_id),0)) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes)", [verification.run_id, owner.userId, verification.revision, verification.manifest_sha256]);
}
/** 전 페이지 적재가 끝난 한 DB 버전에 검증을 고정합니다. 검증 진행은 학습 활성화와 별개입니다. */
export async function beginRestoreVerification(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, now: number): Promise<RestoreVerification> {
  timestamp.parse(now); const archive = await readRestoreManifest(db, bucket, context, owner, id);
  return readStorage("restore.verification-start", async () => {
    if (await storedVerification(db, id) !== null) return currentVerification(db, owner, archive);
    if (archive.run.state !== "verifying") throw backupFailure("export-conflict", "restore.verification-run-state");
    const current: number = await revision(db, owner); const manifest = archive.document.manifest; const rows: number = z.number().int().nonnegative().safe().parse(manifest.counts.reduce((sum, item) => sum + item.rows, 0)); const guard: string = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO restore_verifications(run_id,manifest_sha256,revision,page_count,object_count,row_count,started_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(run_id) DO NOTHING").bind(id, archive.receipt.manifestSha256, current, manifest.pages.length, manifest.objects.length, rows, now),
      backupGuard(db, guard, "EXISTS(SELECT 1 FROM restore_verifications v JOIN restore_runs r ON r.id=v.run_id WHERE v.run_id=? AND v.manifest_sha256=? AND v.revision=? AND r.state='verifying' AND v.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=r.owner_id),0))", [id, archive.receipt.manifestSha256, current]),
      db.prepare("DELETE FROM backup_checks WHERE id=?").bind(guard),
    ]);
    return currentVerification(db, owner, archive);
  });
}
async function verifyRuntimeReferences(db: AtomicDatabase, owner: SiteIdentity, page: BackupPage): Promise<void> {
  const references = page.rows.flatMap((row, index) => runtimeReferences(page.table, row, `restore.${page.table}.rows[${index}]`));
  for (const table of backupCatalog) {
    const ids: readonly string[] = [...new Set(references.filter(item => item.table === table.name).map(item => item.id))];
    for (let offset: number = 0; offset < ids.length; offset += 90) {
      const group = ids.slice(offset, offset + 90); const found = await db.prepare(`SELECT id FROM "${table.name}" WHERE owner_id=? AND id IN (${group.map(() => "?").join(",")})`).bind(owner.userId, ...group).all<{ id: string }>();
      if (!found.success || found.results.length !== group.length) throw backupFailure("invalid-page", `restore.runtime-reference.${table.name}`);
    }
  }
}
function requireItem(saved: RestoreVerificationItem | null, item: RestoreVerificationItem): RestoreVerificationItem {
  if (saved === null || saved.kind !== item.kind || saved.sha256 !== item.sha256 || saved.projected_sha256 !== item.projected_sha256 || saved.object_version !== item.object_version) throw backupFailure("export-conflict", "restore.verification-item"); return saved;
}
async function saveItem(db: AtomicDatabase, owner: SiteIdentity, verification: RestoreVerification, item: RestoreVerificationItem): Promise<RestoreVerificationItem> {
  const guard: string = crypto.randomUUID();
  return readStorage("restore.verification-item", async () => {
    const prior = await storedItem(db, item.run_id, item.path);
    if (prior !== null) {
      if (await revision(db, owner) !== verification.revision) throw backupFailure("export-conflict", "restore.verification-data-changed");
      return requireItem(prior, item);
    }
    await db.batch([
      snapshotGuard(db, guard, verification, owner),
      db.prepare("INSERT INTO restore_verification_items(run_id,path,kind,sha256,projected_sha256,object_version,verified_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(run_id,path) DO NOTHING").bind(item.run_id, item.path, item.kind, item.sha256, item.projected_sha256, item.object_version, item.verified_at),
      backupGuard(db, `${guard}-item`, "EXISTS(SELECT 1 FROM restore_verification_items WHERE run_id=? AND path=? AND kind=? AND sha256=? AND projected_sha256 IS ? AND object_version IS ?)", [item.run_id, item.path, item.kind, item.sha256, item.projected_sha256, item.object_version]),
      snapshotGuard(db, `${guard}-after`, verification, owner),
      db.prepare("DELETE FROM backup_checks WHERE id IN (?,?,?)").bind(guard, `${guard}-item`, `${guard}-after`),
    ]);
    return requireItem(await storedItem(db, item.run_id, item.path), item);
  });
}
/** 원문 페이지·명시적 변환·현재 적재 행과 JSON 안의 참조를 한 페이지씩 다시 대조합니다. */
export async function verifyRestorePage(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, path: string, now: number): Promise<RestoreVerificationItem> {
  timestamp.parse(now); const archive = await readRestoreManifest(db, bucket, context, owner, id); const verification = await readStorage("restore.verification-read", () => currentVerification(db, owner, archive));
  const receipt = await importRestorePage(db, bucket, context, owner, id, path, now);
  const page = await readReceivedRestorePage(db, bucket, archive, path); await readStorage("restore.runtime-references", () => verifyRuntimeReferences(db, owner, page));
  return saveItem(db, owner, verification, { run_id: id, path, kind: "page", sha256: receipt.source_sha256, projected_sha256: receipt.projected_sha256, object_version: null, verified_at: now });
}
/** 저장된 원본을 전체 스트리밍 해시로 확인한 관측만 검증 영수증으로 기록합니다. */
export async function verifyRestoreOriginal(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, ordinal: number, now: number, signal: AbortSignal): Promise<RestoreVerificationItem> {
  timestamp.parse(now); z.number().int().min(0).max(9999).parse(ordinal);
  const archive = await readRestoreManifest(db, bucket, context, owner, id); const verification = await readStorage("restore.verification-read", () => currentVerification(db, owner, archive));
  const original = await readStorage("restore.verification-original", () => readRestoredOriginal(db, id, archive.document.manifest, ordinal));
  const observed = await verifyRestoredOriginal(bucket, id, original.source, AbortSignal.any([signal, AbortSignal.timeout(60000)]));
  if (observed.object.version !== original.objectVersion || observed.object.etag !== original.etag) throw backupFailure("object-changed", "restore.verification-original-version");
  return saveItem(db, owner, verification, { run_id: id, path: original.source.entry.path, kind: "original", sha256: observed.proof.sha256, projected_sha256: null, object_version: original.objectVersion, verified_at: now });
}
/** 수량·참조·페이지·원본 검사가 모두 같은 버전에 있을 때만 verified로 이동합니다. 실행 권한은 부여하지 않습니다. */
export async function finishRestoreVerification(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, now: number): Promise<RestoreVerification> {
  timestamp.parse(now); const archive = await readRestoreManifest(db, bucket, context, owner, id);
  return readStorage("restore.verification-finish", async () => {
    const verification = await currentVerification(db, owner, archive);
    if (verification.completed_at !== null) {
      const state = await db.prepare("SELECT state FROM restore_runs WHERE id=?").bind(id).first<string>("state");
      if (state !== "verified") throw backupFailure("export-conflict", "restore.verification-final-state"); return verification;
    }
    const guard: string = crypto.randomUUID(); const manifest = archive.document.manifest;
    const counts = backupCatalog.map((table, index) => backupGuard(db, `${guard}-count-${index}`, `(SELECT count(*) FROM "${table.name}")=? AND NOT EXISTS(SELECT 1 FROM "${table.name}" WHERE owner_id<>?)`, [manifest.counts.find(item => item.table === table.name)!.rows, owner.userId]));
    const ids = [guard, `${guard}-integrity`, `${guard}-final`, ...backupCatalog.map((_, index) => `${guard}-count-${index}`)];
    await db.batch([
      snapshotGuard(db, guard, verification, owner), ...counts,
      backupGuard(db, `${guard}-integrity`, "(SELECT count(*) FROM restore_verification_items WHERE run_id=? AND kind='page')=? AND (SELECT count(*) FROM restore_verification_items WHERE run_id=? AND kind='original')=? AND NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check) AND NOT EXISTS(SELECT 1 FROM google_tokens) AND NOT EXISTS(SELECT 1 FROM google_runtime) AND NOT EXISTS(SELECT 1 FROM google_oauth_attempts)", [id, verification.page_count, id, verification.object_count]),
      db.prepare("UPDATE restore_verifications SET completed_at=? WHERE run_id=? AND completed_at IS NULL").bind(now, id),
      db.prepare("UPDATE restore_runs SET state='verified' WHERE id=? AND state='verifying'").bind(id),
      backupGuard(db, `${guard}-final`, "EXISTS(SELECT 1 FROM restore_runs r JOIN restore_verifications v ON v.run_id=r.id WHERE r.id=? AND r.state='verified' AND v.completed_at=? AND v.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=r.owner_id),0))", [id, now]),
      db.prepare(`DELETE FROM backup_checks WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids),
    ]);
    return currentVerification(db, owner, archive);
  });
}
