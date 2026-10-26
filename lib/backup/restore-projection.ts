import { backupFailure, validateBackupRow } from "./contracts.ts";
import type { BackupRow, BackupObjectEntry } from "./contracts.ts";
import type { BackupTableName } from "./catalog.ts";
import { canonicalJson } from "../domain/contracts.ts";
import { selectionInput } from "../extraction/selection.ts";
import { contentFact } from "../materials/transfer-state.ts";

export type RestoreObjectMapping = Readonly<{ entry: BackupObjectEntry; objectVersion: string; etag: string }>;
export function restoreUploadReference(table: BackupTableName, row: BackupRow): string | null {
  const value = table === "material_transfers" ? row.id : table === "extraction_jobs" || table === "extraction_results" ? row.upload_id : null;
  return typeof value === "string" ? value : null;
}
/** 새 소유자와 검증된 새 객체 버전만 치환합니다. 자유 입력 본문과 과거 AI 결과를 재작성하지 않습니다. */
export function projectRestoreRow(table: BackupTableName, row: BackupRow, sourceOwner: string, targetOwner: string, mapping: RestoreObjectMapping | null): BackupRow {
  validateBackupRow(table, row, sourceOwner);
  const projected: BackupRow = { ...row, owner_id: targetOwner };
  if (table === "google_connections") return { ...projected, reconnect_required: 1, expires_at: 0 };
  if (table === "material_inventory") return { ...projected, blocked: 1 };
  if (table !== "material_transfers" && table !== "extraction_jobs" && table !== "extraction_results") return projected;
  if (mapping === null) {
    if (table === "material_transfers" && row.state === "discarded") return projected;
    throw backupFailure("invalid-object", "restore.projection-original-missing");
  }
  if (restoreUploadReference(table, row) !== mapping.entry.uploadId) throw backupFailure("invalid-object", "restore.projection-upload");
  if (table === "material_transfers") {
    const fact = contentFact.parse(JSON.parse(String(row.validation)));
    if (row.object_version !== mapping.entry.objectVersion || row.etag !== mapping.entry.etag || fact.objectVersion !== mapping.entry.objectVersion || fact.etag !== mapping.entry.etag || fact.sha256 !== mapping.entry.sha256 || fact.bytes !== mapping.entry.bytes) throw backupFailure("invalid-object", "restore.projection-transfer");
    return { ...projected, object_version: mapping.objectVersion, etag: mapping.etag, validation: canonicalJson({ ...fact, objectVersion: mapping.objectVersion, etag: mapping.etag }) };
  }
  if (table === "extraction_jobs") {
    const selection = selectionInput.parse(JSON.parse(String(row.selection)));
    if (selection.originalVersion !== mapping.entry.objectVersion || selection.originalHash !== mapping.entry.sha256 || selection.materialId !== mapping.entry.materialId) throw backupFailure("invalid-object", "restore.projection-selection");
    return { ...projected, selection: canonicalJson({ ...selection, originalVersion: mapping.objectVersion }) };
  }
  if (row.original_version !== mapping.entry.objectVersion || row.original_hash !== mapping.entry.sha256) throw backupFailure("invalid-object", "restore.projection-result");
  return { ...projected, original_version: mapping.objectVersion };
}
