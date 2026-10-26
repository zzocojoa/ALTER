import { backupCatalogHash, backupFailure, backupPolicy, validateBackupManifest, validateBackupPage } from "./contracts.ts";
import type { BackupManifest, BackupPage } from "./contracts.ts";
import type { RestoreAuthorization } from "./restore-authority.ts";
import { restoreAuthorityFailure } from "./restore-authority.ts";
import { backupTextHash } from "./pagination.ts";
import { canonicalJson, recordId } from "../domain/contracts.ts";
import { materialPolicy } from "../materials/policy.ts";
import { storageMarkerMaximumBytes } from "./storage-identity.ts";

export type RestoreDocumentFact = Readonly<{ bytes: number; sha256: string }>;
export type RestoreManifestDocument = Readonly<{ manifest: BackupManifest; fact: RestoreDocumentFact; reservedBytes: number }>;
export function restoreDocumentKey(runId: string, path: string): string {
  recordId.parse(runId);
  if (path !== "manifest.json" && !/^pages\/[a-z_]+\/[0-9]{6}\.json$/.test(path)) throw backupFailure("invalid-page", "restore.path");
  return `.alter/restore/${runId}/${path}`;
}
export function parseRestoreJson(text: string, maximumBytes: number): unknown {
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw backupFailure("page-too-large", "restore.document");
  try { return JSON.parse(text) as unknown; }
  catch (error: unknown) { if (error instanceof SyntaxError) throw backupFailure("invalid-page", "restore.json"); throw error; }
}
export async function restoreDocumentFact(text: string): Promise<RestoreDocumentFact> {
  return { bytes: new TextEncoder().encode(text).byteLength, sha256: await backupTextHash(text) };
}
/** 원본·중간 페이지·매니페스트를 함께 예약하며 해시가 일치하기 전에는 수신 대상에 쓰지 않습니다. */
export async function validateRestoreManifestDocument(text: string, authorization: RestoreAuthorization): Promise<RestoreManifestDocument> {
  const manifest = validateBackupManifest(parseRestoreJson(text, backupPolicy.maximumManifestBytes), await backupCatalogHash());
  const fact = await restoreDocumentFact(text);
  if (manifest.backupId !== authorization.backupId || fact.sha256 !== authorization.manifestSha256 || manifest.basis.sourceProjectId !== authorization.source.projectId || manifest.basis.ownerId !== authorization.source.owner.userId) throw restoreAuthorityFailure("wrong-backup", "manifest-source-and-hash");
  const reserved = BigInt(fact.bytes + storageMarkerMaximumBytes + 1024) + [...manifest.pages, ...manifest.objects].reduce((sum: bigint, entry): bigint => sum + BigInt(entry.bytes), BigInt(0));
  if (reserved > BigInt(materialPolicy.maximumStorageBytes)) throw backupFailure("invalid-object", "restore.application-capacity");
  return { manifest, fact, reservedBytes: Number(reserved) };
}
/** 페이지 원문 해시와 매니페스트의 모든 커서·개수·소유자 기준을 다시 대조합니다. */
export async function validateRestorePageDocument(text: string, manifest: BackupManifest, path: string): Promise<Readonly<{ page: BackupPage; fact: RestoreDocumentFact }>> {
  const entry = manifest.pages.find(item => item.path === path);
  if (entry === undefined) throw backupFailure("invalid-page", "restore.undeclared-page");
  const page = validateBackupPage(parseRestoreJson(text, backupPolicy.maximumPageBytes)); const fact = await restoreDocumentFact(text);
  if (fact.bytes !== entry.bytes || fact.sha256 !== entry.sha256 || page.backupId !== manifest.backupId || canonicalJson(page.basis) !== canonicalJson(manifest.basis) || page.table !== entry.table || page.ordinal !== entry.ordinal || page.cursorBefore !== entry.cursorBefore || page.cursorAfter !== entry.cursorAfter || page.final !== entry.final || page.rows.length !== entry.count) throw backupFailure("invalid-page", "restore.page-manifest");
  return { page, fact };
}
