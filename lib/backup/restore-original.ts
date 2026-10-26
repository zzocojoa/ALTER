import { z } from "zod";
import { backupFailure, backupPolicy } from "./contracts.ts";
import type { BackupManifest, BackupObjectEntry, BackupPage } from "./contracts.ts";
import { validateMaterialMetadata } from "../materials/policy.ts";
import type { MaterialObjectIdentity } from "../materials/object.ts";
import { contentFact } from "../materials/transfer-state.ts";

export const restoreOriginalInput = z.object({ ordinal: z.number().int().min(0).max(backupPolicy.maximumObjects - 1), uploadPage: z.number().int().min(0).max(backupPolicy.maximumPages - 1), transferPage: z.number().int().min(0).max(backupPolicy.maximumPages - 1) }).strict();
export type RestoreOriginalInput = Readonly<z.infer<typeof restoreOriginalInput>>;
export type RestoreOriginalPlan = Readonly<{ entry: BackupObjectEntry; mime: string; originalUploadId: string }>;
/** 백업 매니페스트와 실제 수신한 업로드·전송 기록이 같은 원본을 가리켜야 합니다. */
export function planRestoreOriginal(manifest: BackupManifest, input: RestoreOriginalInput, uploads: BackupPage, transfers: BackupPage): RestoreOriginalPlan {
  restoreOriginalInput.parse(input); const entry = manifest.objects[input.ordinal];
  if (entry === undefined || entry.objectKey.startsWith(".alter/") || entry.objectKey === ".alter") throw backupFailure("invalid-object", "restore.original-key");
  if (uploads.table !== "uploads" || uploads.ordinal !== input.uploadPage || transfers.table !== "material_transfers" || transfers.ordinal !== input.transferPage) throw backupFailure("invalid-page", "restore.original-source-page");
  const upload = uploads.rows.find(row => row.id === entry.uploadId); const transfer = transfers.rows.find(row => row.id === entry.uploadId);
  if (upload === undefined || transfer === undefined || upload.material_id !== entry.materialId || transfer.material_id !== entry.materialId || upload.state !== "verified" || transfer.state !== "registered" || transfer.write_status !== "succeeded" || upload.object_key !== entry.objectKey || upload.expected_hash !== entry.sha256 || upload.verified_hash !== entry.sha256 || upload.bytes !== entry.bytes || transfer.actual_bytes !== entry.bytes || transfer.actual_hash !== entry.sha256 || transfer.object_version !== entry.objectVersion || transfer.etag !== entry.etag || typeof upload.upload_id !== "string") throw backupFailure("invalid-object", "restore.original-facts");
  const metadata = validateMaterialMetadata(JSON.parse(String(transfer.metadata))); const fact = contentFact.parse(JSON.parse(String(transfer.validation)));
  if (metadata.bytes !== entry.bytes || metadata.sha256 !== entry.sha256 || fact.bytes !== entry.bytes || fact.sha256 !== entry.sha256 || fact.objectVersion !== entry.objectVersion || fact.etag !== entry.etag || fact.kind !== metadata.kind) throw backupFailure("invalid-object", "restore.original-validation");
  return { entry, mime: metadata.mime, originalUploadId: upload.upload_id };
}
export function restoreOriginalMetadata(runId: string, plan: RestoreOriginalPlan): R2PutOptions {
  return { onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: plan.mime }, customMetadata: { alterTransferId: plan.entry.uploadId, alterUploadId: plan.originalUploadId, alterSha256: plan.entry.sha256, alterMaterialId: plan.entry.materialId, alterRestoreRunId: runId } };
}
export function requireRestoredOriginalIdentity(object: MaterialObjectIdentity, runId: string, plan: RestoreOriginalPlan): void {
  if (object.key !== plan.entry.objectKey || object.size !== plan.entry.bytes || object.httpMetadata?.contentType !== plan.mime || object.customMetadata?.alterTransferId !== plan.entry.uploadId || object.customMetadata?.alterUploadId !== plan.originalUploadId || object.customMetadata?.alterSha256 !== plan.entry.sha256 || object.customMetadata?.alterMaterialId !== plan.entry.materialId || object.customMetadata?.alterRestoreRunId !== runId) throw backupFailure("invalid-object", "restore.original-identity");
}
