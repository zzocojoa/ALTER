import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { backupCatalog } from "../../lib/backup/catalog.ts";
import type { BackupTableName } from "../../lib/backup/catalog.ts";
import { backupCatalogHash, backupPagePath } from "../../lib/backup/contracts.ts";
import type { BackupManifest, BackupRow, BackupObjectEntry } from "../../lib/backup/contracts.ts";
import type { BackupPageEntry } from "../../lib/backup/pagination.ts";
import { recordId } from "../../lib/domain/contracts.ts";
import { materialPolicy } from "../../lib/materials/policy.ts";

export type FixtureRows = Readonly<Partial<Record<BackupTableName, readonly BackupRow[]>>>;
export const backupFixtureOwner: string = "preflight-owner";
export const backupFixtureId = (n: number): BackupManifest["backupId"] => recordId.parse(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
export const originalBytes: Uint8Array = new TextEncoder().encode("검증 원본 자료");
const hash: string = createHash("sha256").update(originalBytes).digest("hex");
export const originalEntry: BackupObjectEntry = { materialId: backupFixtureId(3), uploadId: backupFixtureId(4), objectKey: "learning/test-original", path: "objects/000000.bin", bytes: originalBytes.length, objectVersion: "v1", etag: "etag1", sha256: hash };
export function preflightFixtureRows(): FixtureRows {
  const owner_id: string = backupFixtureOwner; const last_request_id: string = backupFixtureId(99);
  const fact = { objectVersion: "v1", etag: "etag1", sha256: hash, bytes: originalBytes.length, pages: 1, kind: "text", policyVersion: materialPolicy.version };
  const metadata = { title: "검증 원본", edition: "", role: "reference", kind: "text", filename: "test.txt", mime: "text/plain", bytes: originalBytes.length, sha256: hash };
  return {
    courses: [{ owner_id, id: backupFixtureId(1), version: 1, last_request_id, title: "검증 과정" }],
    units: [{ owner_id, id: backupFixtureId(2), version: 1, last_request_id, course_id: backupFixtureId(1), ordinal: 1, title: "검증 단원" }],
    materials: [{ owner_id, id: backupFixtureId(3), version: 1, last_request_id, course_id: backupFixtureId(1), title: "검증 원본", origin: "upload", original_id: null, modified_at: null }],
    uploads: [{ owner_id, id: backupFixtureId(4), version: 1, last_request_id, material_id: backupFixtureId(3), object_key: originalEntry.objectKey, upload_id: backupFixtureId(5), state: "verified", expected_hash: hash, verified_hash: hash, bytes: originalBytes.length, recovery_at: 1 }],
    material_transfers: [{ owner_id, id: backupFixtureId(4), material_id: backupFixtureId(3), version: 1, last_request_id, metadata: JSON.stringify(metadata), state: "registered", write_status: "succeeded", object_version: "v1", etag: "etag1", actual_hash: hash, actual_bytes: originalBytes.length, validation: JSON.stringify(fact), failure_code: null, updated_at: 2 }],
    material_files: [{ owner_id, material_id: backupFixtureId(3), transfer_id: backupFixtureId(4), registered_at: 2 }],
    material_pages: [{ owner_id, id: backupFixtureId(6), material_id: backupFixtureId(3), upload_id: backupFixtureId(4), file_page: 1, printed_page: "i", content: "검증 원본 자료", result_version: 1 }],
    source_references: [{ owner_id, id: backupFixtureId(7), material_id: backupFixtureId(3), upload_id: backupFixtureId(4), page_id: backupFixtureId(6), file_page: 1, printed_page: "i", span_start: 0, span_end: 8, evidence: "검증 원본 자료" }],
  };
}
/** 손상된 행도 그대로 작성해 검증기가 거부하는지 시험합니다. */
export async function writeBackupFixture(root: string, rows: FixtureRows, objects: readonly BackupObjectEntry[]): Promise<BackupManifest> {
  const pages: BackupPageEntry[] = []; const basis = { ownerId: backupFixtureOwner, sourceProjectId: "local-preflight-test", catalogHash: await backupCatalogHash(), startedAt: 100, revision: 1 };
  for (const table of backupCatalog) {
    const source: readonly BackupRow[] = rows[table.name] ?? [];
    for (let ordinal: number = 0; ordinal < Math.max(1, source.length); ordinal += 1) {
      const selected: readonly BackupRow[] = source.slice(ordinal, ordinal + 1);
      const page = { schemaVersion: 1, backupId: backupFixtureId(90), basis, table: table.name, role: table.role, ordinal, cursorBefore: ordinal, cursorAfter: ordinal + selected.length, final: ordinal === Math.max(1, source.length) - 1, rows: selected };
      const json: string = JSON.stringify(page); const filename: string = backupPagePath(table.name, ordinal);
      pages.push({ table: table.name, ordinal, path: filename, bytes: Buffer.byteLength(json), sha256: createHash("sha256").update(json).digest("hex"), count: selected.length, cursorBefore: page.cursorBefore, cursorAfter: page.cursorAfter, final: page.final });
      await mkdir(path.join(root, "pages", table.name), { recursive: true }); await writeFile(path.join(root, filename), json);
    }
  }
  for (const object of objects) { await mkdir(path.join(root, "objects"), { recursive: true }); await writeFile(path.join(root, object.path), originalBytes); }
  const manifest: BackupManifest = { schemaVersion: 1, backupId: backupFixtureId(90), basis, completedAt: 101, checksumAlgorithm: "SHA-256", executionAuthority: "none", credentials: "excluded", state: "complete", pages, objects: [...objects], counts: backupCatalog.map(table => ({ table: table.name, rows: rows[table.name]?.length ?? 0 })) };
  await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest)); return manifest;
}
