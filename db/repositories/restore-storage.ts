import { z } from "zod";
import { verifyMaterialInventory } from "../../lib/materials/inventory.ts";
import { canonicalJson, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { requireIsolatedRestoreTarget, restoreAuthorityFailure, restoreStorageIdentity } from "../../lib/backup/restore-authority.ts";
import type { RestoreStorageIdentity } from "../../lib/backup/restore-authority.ts";
import { createStorageMarker, readStorageMarker, requireEmptyRestoreBucket, requireStorageContext, requireStorageOwner } from "../../lib/backup/storage-identity.ts";
import type { StorageContext, StorageMarker } from "../../lib/backup/storage-identity.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase } from "./atomic.ts";
import { backupGuard } from "./backup.ts";

const storedStorage = z.object({ identity: z.string().max(2048), state: z.enum(["reserved", "ready"]), marker_version: z.string().nullable(), marker_bytes: z.number().int().positive().nullable(), created_at: timestamp, ready_at: timestamp.nullable() }).strict();
type StoredStorage = Readonly<z.infer<typeof storedStorage>>;
export type RegisteredStorage = Readonly<{ identity: RestoreStorageIdentity; markerVersion: string; markerBytes: number }>;
async function readRegistration(db: AtomicDatabase): Promise<StoredStorage | null> {
  const row = await readStorage("restore.storage-read", () => db.prepare("SELECT identity,state,marker_version,marker_bytes,created_at,ready_at FROM restore_storage WHERE slot=1").first<StoredStorage>());
  return row === null ? null : storedStorage.parse(row);
}
function parseIdentity(row: StoredStorage): RestoreStorageIdentity {
  try { return restoreStorageIdentity.parse(JSON.parse(row.identity)); }
  catch (error: unknown) { if (error instanceof z.ZodError || error instanceof SyntaxError) throw restoreAuthorityFailure("unsafe-target", "database-identity"); throw error; }
}
/** DB의 실제 테이블 목록에서 내부 메타데이터만 제외합니다. 새 업무 테이블도 자동으로 빈 대상 검사에 포함됩니다. */
async function emptyDatabaseGuards(db: AtomicDatabase, check: string): Promise<readonly D1PreparedStatement[]> {
  const result = await readStorage("restore.table-list", () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name LIMIT 513").all<{ name: string }>());
  if (result.results.length > 512 || result.results.some(row => !/^[a-z_][a-z0-9_]*$/.test(row.name))) throw restoreAuthorityFailure("unsafe-target", "table-catalog");
  const excluded: readonly string[] = ["owner_enrollment", "restore_storage", "backup_checks", "d1_migrations", "__drizzle_migrations", "__appgarden_migrations"];
  const tables: readonly string[] = result.results.map(row => row.name).filter(name => !excluded.includes(name));
  for (let index: number = 0; index < tables.length; index += 16) {
    const names: readonly string[] = tables.slice(index, index + 16);
    const present = await readStorage("restore.nonempty-tables", () => db.prepare(`SELECT ${names.map(name => `EXISTS(SELECT 1 FROM "${name}" LIMIT 1) AS "${name}"`).join(",")}`).first<{ [tableName: string]: number }>());
    if (present === null) throw restoreAuthorityFailure("unsafe-target", "empty-check-unconfirmed");
    const nonempty: readonly string[] = names.filter(name => present[name] !== 0);
    if (nonempty.length > 0) throw restoreAuthorityFailure("unsafe-target", `nonempty-database:${nonempty.join(",")}`);
  }
  return Array.from({ length: Math.ceil(tables.length / 16) }, (_, index) => [backupGuard(db, `${check}-${index}`, tables.slice(index * 16, index * 16 + 16).map(name => `NOT EXISTS(SELECT 1 FROM "${name}" LIMIT 1)`).join(" AND "), []), db.prepare("DELETE FROM backup_checks WHERE id=?").bind(`${check}-${index}`)]).flat();
}
async function reserveRegistration(db: AtomicDatabase, intended: RestoreStorageIdentity, now: number, checks: readonly D1PreparedStatement[]): Promise<StoredStorage> {
  timestamp.parse(now); const identity: string = canonicalJson(intended);
  await readStorage("restore.storage-reserve", () => db.batch([
    ...checks,
    db.prepare("INSERT INTO restore_storage(slot,identity,state,created_at) VALUES (1,?,'reserved',?) ON CONFLICT(slot) DO NOTHING").bind(identity, now),
  ]));
  const row: StoredStorage | null = await readRegistration(db);
  if (row === null) throw restoreAuthorityFailure("unsafe-target", "registration-missing");
  return row;
}
async function confirmRegistration(db: AtomicDatabase, row: StoredStorage, marker: StorageMarker, now: number, checks: readonly D1PreparedStatement[]): Promise<RegisteredStorage> {
  timestamp.parse(now); const identity = parseIdentity(row); const check: string = crypto.randomUUID();
  if (canonicalJson(identity) !== canonicalJson(marker.identity)) throw restoreAuthorityFailure("unsafe-target", "marker-binding");
  await readStorage("restore.storage-confirm", () => db.batch([
    ...checks,
    db.prepare("UPDATE restore_storage SET state='ready',marker_version=?,marker_bytes=?,ready_at=? WHERE slot=1 AND state='reserved' AND identity=?").bind(marker.version, marker.bytes, now, row.identity),
    backupGuard(db, check, "EXISTS(SELECT 1 FROM restore_storage WHERE slot=1 AND state='ready' AND identity=? AND marker_version=? AND marker_bytes=?)", [row.identity, marker.version, marker.bytes]),
    db.prepare("DELETE FROM backup_checks WHERE id=?").bind(check),
  ]));
  return { identity, markerVersion: marker.version, markerBytes: marker.bytes };
}
/** DB 등록 상태와 실제 R2 표식의 일치를 매번 확인합니다. */
export async function readRegisteredStorage(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, authenticatedOwner: SiteIdentity, purpose: RestoreStorageIdentity["purpose"]): Promise<RegisteredStorage> {
  requireStorageOwner(context, authenticatedOwner); const row: StoredStorage | null = await readRegistration(db);
  if (row === null || row.state !== "ready") throw restoreAuthorityFailure("unsafe-target", "registration-incomplete");
  const identity = parseIdentity(row); requireStorageContext(identity, context, purpose);
  const marker = await readStorageMarker(bucket);
  if (marker === null || canonicalJson(marker.identity) !== row.identity || marker.version !== row.marker_version || marker.bytes !== row.marker_bytes) throw restoreAuthorityFailure("unsafe-target", "registration-marker");
  return { identity, markerVersion: marker.version, markerBytes: marker.bytes };
}
function newIdentity(context: StorageContext, purpose: RestoreStorageIdentity["purpose"]): RestoreStorageIdentity { return restoreStorageIdentity.parse({ ...context, purpose, databaseId: crypto.randomUUID(), bucketId: crypto.randomUUID() }); }
/** 운영 등록은 기존 학습 자료를 유지하며 별도 표식만 조건부 생성합니다. */
export async function registerPrimaryStorage(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, authenticatedOwner: SiteIdentity, now: number): Promise<RegisteredStorage> {
  requireStorageOwner(context, authenticatedOwner);
  const previous = await readRegistration(db); const before = await readStorageMarker(bucket);
  if (before !== null && (previous === null || canonicalJson(before.identity) !== previous.identity)) throw restoreAuthorityFailure("unsafe-target", "foreign-bucket");
  const row: StoredStorage = await reserveRegistration(db, newIdentity(context, "primary"), now, []);
  const identity = parseIdentity(row); requireStorageContext(identity, context, "primary");
  if (row.state === "ready") return readRegisteredStorage(db, bucket, context, authenticatedOwner, "primary");
  await verifyMaterialInventory(db, bucket, authenticatedOwner, now);
  const marker: StorageMarker = await createStorageMarker(bucket, identity);
  return confirmRegistration(db, row, marker, now, []);
}
/** 원본 식별자는 원본 서버의 확인 결과로 전달해야 합니다. 중단 시 reserved 상태와 표식을 보존합니다. */
export async function registerRestoreStorage(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, authenticatedOwner: SiteIdentity, source: RestoreStorageIdentity, now: number): Promise<RegisteredStorage> {
  requireStorageOwner(context, authenticatedOwner); const intended = newIdentity(context, "restore-test"); requireIsolatedRestoreTarget(source, intended);
  const previous = await readRegistration(db);
  if (previous !== null) {
    const identity = parseIdentity(previous); requireStorageContext(identity, context, "restore-test"); requireIsolatedRestoreTarget(source, identity);
    if (previous.state === "ready") return readRegisteredStorage(db, bucket, context, authenticatedOwner, "restore-test");
  }
  const before = await readStorageMarker(bucket); await requireEmptyRestoreBucket(bucket, before);
  if (before !== null && (previous === null || canonicalJson(before.identity) !== previous.identity)) throw restoreAuthorityFailure("unsafe-target", "foreign-bucket");
  const row: StoredStorage = await reserveRegistration(db, intended, now, await emptyDatabaseGuards(db, crypto.randomUUID()));
  const identity = parseIdentity(row); requireStorageContext(identity, context, "restore-test"); requireIsolatedRestoreTarget(source, identity);
  if (row.state === "ready") return readRegisteredStorage(db, bucket, context, authenticatedOwner, "restore-test");
  const marker: StorageMarker = await createStorageMarker(bucket, identity); await requireEmptyRestoreBucket(bucket, marker);
  return confirmRegistration(db, row, marker, now, await emptyDatabaseGuards(db, crypto.randomUUID()));
}
