import { readStorage } from "../../db/repositories/atomic.ts";
import type { StoredTransfer } from "../../db/repositories/material-transfers.ts";
import { materialFailure } from "./policy.ts";

export type MaterialObjectIdentity = Pick<R2Object, "key" | "version" | "etag" | "size" | "httpMetadata" | "customMetadata">;

/** 미확정 쓰기의 관측도 서버에서 발급한 시도 식별자와 내용 선언에 연결합니다. */
export function requireMaterialObjectIdentity(object: MaterialObjectIdentity, transfer: StoredTransfer): void {
  if (object.key !== transfer.objectKey || object.size !== transfer.metadata.bytes || object.httpMetadata?.contentType !== transfer.metadata.mime || object.customMetadata?.alterTransferId !== transfer.id || object.customMetadata?.alterUploadId !== transfer.uploadId || object.customMetadata?.alterMaterialId !== transfer.materialId || object.customMetadata?.alterSha256 !== transfer.metadata.sha256) throw materialFailure("material_storage_unavailable", "object-identity-mismatch", 409);
}

/** 저장 때 관측한 버전까지 일치해야 원본 읽기나 검증을 진행합니다. */
export function requireMaterialObject(object: MaterialObjectIdentity, transfer: StoredTransfer): void {
  requireMaterialObjectIdentity(object, transfer);
  const saved = transfer.snapshot.object;
  if (saved === null || object.version !== saved.objectVersion || object.etag !== saved.etag) throw materialFailure("material_storage_unavailable", "object-version-mismatch", 409);
}

export async function headMaterialObject(bucket: Pick<R2Bucket, "head">, transfer: StoredTransfer): Promise<R2Object> {
  const object: R2Object | null = await readStorage("material.r2.head", (): Promise<R2Object | null> => bucket.head(transfer.objectKey));
  if (object === null) throw materialFailure("material_storage_unavailable", "object-missing", 409);
  requireMaterialObject(object, transfer);
  return object;
}

export async function readMaterialObject(bucket: Pick<R2Bucket, "get">, transfer: StoredTransfer): Promise<R2ObjectBody> {
  if (transfer.snapshot.object === null) throw materialFailure("material_storage_unavailable", "stored-object-fact-missing", 409);
  const etag: string = transfer.snapshot.object.etag;
  const object: R2ObjectBody | R2Object | null = await readStorage("material.r2.get", (): Promise<R2ObjectBody | R2Object | null> => bucket.get(transfer.objectKey, { onlyIf: { etagMatches: etag } }));
  if (object === null || !("body" in object)) throw materialFailure("material_storage_unavailable", "object-missing-or-changed", 409);
  try { requireMaterialObject(object, transfer); }
  catch (error: unknown) { await object.body.cancel(error); throw error; }
  return object;
}
