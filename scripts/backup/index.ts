import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { backupCatalog } from "../../lib/backup/catalog.ts";
import type { BackupTable } from "../../lib/backup/catalog.ts";
import type { BackupObjectEntry, BackupRow, BackupScalar } from "../../lib/backup/contracts.ts";
import { validateMaterialMetadata } from "../../lib/materials/policy.ts";
import { contentFact } from "../../lib/materials/transfer-state.ts";
import { runtimeReferences } from "./runtime-references.ts";
import { requirePreflight } from "./failure.ts";

/** 대상 D1과 별개인 임시 로컬 색인입니다. 본문 대신 식별자 해시와 오류 위치만 저장합니다. */
export function createBackupIndex(filename: string): DatabaseSync {
  const db: DatabaseSync = new DatabaseSync(filename, { allowExtension: false });
  try { db.exec("PRAGMA trusted_schema=OFF; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE; CREATE TABLE keys(domain TEXT NOT NULL,hash TEXT NOT NULL,location TEXT NOT NULL,PRIMARY KEY(domain,hash)) STRICT; CREATE TABLE refs(domain TEXT NOT NULL,hash TEXT NOT NULL,location TEXT NOT NULL) STRICT; CREATE INDEX refs_key ON refs(domain,hash);"); }
  catch (error: unknown) { db.close(); throw error; }
  return db;
}
function domain(table: string, columns: readonly string[]): string { return JSON.stringify([table, columns]); }
function hash(values: readonly BackupScalar[]): string { return createHash("sha256").update(JSON.stringify(values)).digest("hex"); }
function addKey(db: DatabaseSync, name: string, values: readonly BackupScalar[], location: string): void {
  requirePreflight(values.every(value => value !== null && value !== ""), "invalid-identifier", location, "non-empty key", "empty key");
  const value: string = hash(values);
  requirePreflight(db.prepare("SELECT 1 FROM keys WHERE domain=? AND hash=?").get(name, value) === undefined, "duplicate-key", location, "unique identifier", "already present");
  db.prepare("INSERT INTO keys VALUES(?,?,?)").run(name, value, location);
}
function addReference(db: DatabaseSync, name: string, values: readonly BackupScalar[], location: string): void {
  if (values.some(value => value === null)) return;
  db.prepare("INSERT INTO refs VALUES(?,?,?)").run(name, hash(values), location);
}
const objectLink: string = "object.material-upload";
const objectUpload: string = "object.upload-fact";
const objectVersion: string = "object.version-fact";

export function indexBackupObject(db: DatabaseSync, ownerId: string, object: BackupObjectEntry): void {
  const location: string = object.path;
  addKey(db, objectLink, [ownerId, object.materialId, object.uploadId], location);
  addKey(db, objectUpload, [ownerId, object.uploadId, object.materialId, object.objectKey, object.bytes, object.sha256], location);
  addKey(db, objectVersion, [ownerId, object.uploadId, object.materialId, object.objectVersion, object.etag, object.bytes, object.sha256], location);
  addReference(db, domain("uploads", ["owner_id", "id"]), [ownerId, object.uploadId], location);
  addReference(db, domain("material_transfers", ["owner_id", "id"]), [ownerId, object.uploadId], location);
  addReference(db, "registered-file", [ownerId, object.materialId, object.uploadId], location);
  addReference(db, "registered-transfer", [ownerId, object.uploadId], location);
}
function indexOriginal(db: DatabaseSync, table: string, row: BackupRow, location: string): void {
  if (table === "material_files") { addReference(db, objectLink, [row.owner_id, row.material_id, row.transfer_id], location); addKey(db, "registered-file", [row.owner_id, row.material_id, row.transfer_id], location); }
  if (table === "uploads") {
    requirePreflight(row.state === "verified" || row.state === "missing", "unsettled-upload", location, "verified or confirmed missing", "unresolved state");
    addKey(db, "upload-state", [row.owner_id, row.id, row.state], location);
    if (row.state === "verified") {
      requirePreflight(row.expected_hash === row.verified_hash, "object-mismatch", location, "equal expected and verified hash", "hash mismatch");
      addReference(db, objectUpload, [row.owner_id, row.id, row.material_id, row.object_key, row.bytes, row.verified_hash], location);
    }
    addReference(db, domain("material_transfers", ["owner_id", "id"]), [row.owner_id, row.id], location);
  }
  if (table === "material_transfers") {
    requirePreflight(row.state === "registered" || row.state === "discarded", "unsettled-upload", location, "registered or discarded", "unresolved state");
    addReference(db, "upload-state", [row.owner_id, row.id, row.state === "registered" ? "verified" : "missing"], location);
    if (row.state === "registered") {
      addKey(db, "registered-transfer", [row.owner_id, row.id], location);
      const metadata = validateMaterialMetadata(JSON.parse(String(row.metadata)));
      const fact = contentFact.parse(JSON.parse(String(row.validation)));
      requirePreflight(row.write_status === "succeeded" && row.actual_bytes === metadata.bytes && row.actual_hash === metadata.sha256 && fact.bytes === row.actual_bytes && fact.sha256 === row.actual_hash && fact.objectVersion === row.object_version && fact.etag === row.etag && fact.kind === metadata.kind, "object-mismatch", location, "consistent verified original", "mismatched original facts");
      addReference(db, objectVersion, [row.owner_id, row.id, row.material_id, row.object_version, row.etag, row.actual_bytes, row.actual_hash], location);
    }
  }
}
/** 복합키도 열 순서를 보존하며, 행 사이 참조는 모든 페이지를 읽은 뒤 대조합니다. */
export function indexBackupRow(db: DatabaseSync, table: BackupTable, row: BackupRow, location: string): void {
  const targetColumns: Map<string, readonly string[]> = new Map([[domain(table.name, table.primaryKey), table.primaryKey]]);
  for (const candidate of backupCatalog) for (const reference of candidate.references) if (reference.table === table.name) targetColumns.set(domain(table.name, reference.target), reference.target);
  for (const [name, columns] of targetColumns) addKey(db, name, columns.map(column => row[column]), location);
  for (const reference of table.references) addReference(db, domain(reference.table, reference.target), reference.columns.map(column => row[column]), `${location}.${reference.columns.join("+")}`);
  for (const reference of runtimeReferences(table.name, row, location)) addReference(db, domain(reference.table, ["owner_id", "id"]), [row.owner_id, reference.id], `${location}.${reference.field}`);
  indexOriginal(db, table.name, row, location);
}
export function verifyBackupReferences(db: DatabaseSync): void {
  const missing = db.prepare("SELECT r.location,r.domain FROM refs r LEFT JOIN keys k ON k.domain=r.domain AND k.hash=r.hash WHERE k.hash IS NULL LIMIT 1").get();
  requirePreflight(missing === undefined, "missing-reference", String(missing?.location ?? "references"), `matching key ${String(missing?.domain ?? "")}`, "target not present");
}
