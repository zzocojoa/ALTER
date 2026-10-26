import { mkdtemp, rm } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { backupCatalog } from "../../lib/backup/catalog.ts";
import { backupCatalogHash, backupPolicy, backupTable, validateBackupManifest, validateBackupPage } from "../../lib/backup/contracts.ts";
import type { BackupManifest, BackupPage } from "../../lib/backup/contracts.ts";
import { canonicalJson } from "../../lib/domain/contracts.ts";
import { backupRoot, hashBackupFile, inspectBackupFile, inventoryBackup, readBackupJson } from "./files.ts";
import { createBackupIndex, indexBackupObject, indexBackupRow, verifyBackupReferences } from "./index.ts";
import { preflightFailure, requirePreflight } from "./failure.ts";
import type { PreflightFailure } from "./failure.ts";

export type BackupPreflightReport = Readonly<{ status: "passed"; authority: "preflight-only"; backupId: string; sourceProjectId: string; sourceOwnerId: string; manifestSha256: string; pages: number; objects: number; objectBytes: number; counts: BackupManifest["counts"]; historyTables: readonly string[]; ownerRemapping: "requires-server-confirmed-source-and-target"; googleConnection: "requires-new-consent"; targetWrites: 0; providerCalls: 0; maximumFileReadBufferBytes: 65536 }>;
function parsePage(value: unknown, location: string): BackupPage {
  try { return validateBackupPage(value); }
  catch (error: unknown) { if (error instanceof Error && error.name === "BackupFailure") throw preflightFailure("invalid-page", location, "supported page fields and owner", error.message); throw error; }
}
/** 네트워크·대상 DB·R2 핸들을 받지 않습니다. 임시 키 색인만 만들고 모든 종료 경로에서 삭제합니다. */
export async function preflightBackup(directory: string): Promise<BackupPreflightReport> {
  const root: string = await backupRoot(directory);
  const manifestFile = await inspectBackupFile(root, "manifest.json");
  const raw = await readBackupJson(root, manifestFile, backupPolicy.maximumManifestBytes);
  let manifest: BackupManifest;
  try { manifest = validateBackupManifest(raw.value, await backupCatalogHash()); }
  catch (error: unknown) { if (error instanceof Error && error.name === "BackupFailure") throw preflightFailure("invalid-manifest", "manifest.json", "supported complete manifest", error.message); throw error; }
  const files = await inventoryBackup(root); const byName = new Map(files.map(file => [file.name, file]));
  const expected: Set<string> = new Set(["manifest.json", ...manifest.pages.map(page => page.path), ...manifest.objects.map(object => object.path)]);
  for (const name of expected) requirePreflight(byName.has(name), "file-set", name, "file declared by manifest", "missing file");
  for (const file of files) requirePreflight(expected.has(file.name), "file-set", file.name, "only files declared by manifest", "unexpected file");
  const temporary: string = await mkdtemp(path.join(tmpdir(), "alter-backup-preflight-")); let db: DatabaseSync | null = null;
  try {
    db = createBackupIndex(path.join(temporary, "keys.sqlite"));
    for (const object of manifest.objects) indexBackupObject(db, manifest.basis.ownerId, object);
    for (const entry of manifest.pages) {
      const file = byName.get(entry.path); requirePreflight(file !== undefined, "missing-file", entry.path, "manifest page", "absent"); if (!file) throw new Error("파일 목록 검증 불변식 실패");
      const decoded = await readBackupJson(root, file, backupPolicy.maximumPageBytes);
      requirePreflight(decoded.digest.bytes === entry.bytes && decoded.digest.sha256 === entry.sha256, "checksum-mismatch", entry.path, `${entry.bytes} bytes / ${entry.sha256}`, `${decoded.digest.bytes} bytes / ${decoded.digest.sha256}`);
      const page: BackupPage = parsePage(decoded.value, entry.path);
      requirePreflight(page.backupId === manifest.backupId && canonicalJson(page.basis) === canonicalJson(manifest.basis) && page.table === entry.table && page.ordinal === entry.ordinal && page.cursorBefore === entry.cursorBefore && page.cursorAfter === entry.cursorAfter && page.final === entry.final && page.rows.length === entry.count, "page-manifest-mismatch", entry.path, "matching manifest page", "page metadata mismatch");
      const table = backupTable(page.table); db.exec("BEGIN");
      try { for (const [i, row] of page.rows.entries()) indexBackupRow(db, table, row, `${entry.path}.rows[${i}]`); db.exec("COMMIT"); }
      catch (error: unknown) { db.exec("ROLLBACK"); if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof Error && error.name === "MaterialFailure") throw preflightFailure("invalid-state", entry.path, "valid original metadata", "invalid structure"); throw error; }
    }
    verifyBackupReferences(db);
    for (const object of manifest.objects) {
      const file = byName.get(object.path); if (!file) throw preflightFailure("missing-file", object.path, "manifest original", "absent");
      const digest = await hashBackupFile(root, file);
      requirePreflight(digest.bytes === object.bytes && digest.sha256 === object.sha256, "checksum-mismatch", object.path, `${object.bytes} bytes / ${object.sha256}`, `${digest.bytes} bytes / ${digest.sha256}`);
    }
    const final = await inventoryBackup(root);
    requirePreflight(canonicalJson(final) === canonicalJson(files) && byName.get("manifest.json")?.fingerprint === manifestFile.fingerprint, "file-changed", "archive", "unchanged archive throughout validation", "changed files");
    return { status: "passed", authority: "preflight-only", backupId: manifest.backupId, sourceProjectId: manifest.basis.sourceProjectId, sourceOwnerId: manifest.basis.ownerId, manifestSha256: raw.digest.sha256, pages: manifest.pages.length, objects: manifest.objects.length, objectBytes: manifest.objects.reduce((sum, object) => sum + object.bytes, 0), counts: manifest.counts, historyTables: backupCatalog.filter(table => table.role === "history-only").map(table => table.name), ownerRemapping: "requires-server-confirmed-source-and-target", googleConnection: "requires-new-consent", targetWrites: 0, providerCalls: 0, maximumFileReadBufferBytes: 65536 };
  } finally { try { db?.close(); } finally { await rm(temporary, { recursive: true, force: false }); } }
}
export function isPreflightFailure(error: unknown): error is PreflightFailure { return error instanceof Error && error.name === "PreflightFailure" && "issue" in error; }
