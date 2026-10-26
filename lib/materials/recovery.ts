import { version } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { readStorage } from "../../db/repositories/atomic.ts";
import { getMaterialTransfer } from "../../db/repositories/material-transfers.ts";
import type { StoredTransfer } from "../../db/repositories/material-transfers.ts";
import { materialFailure, materialPolicy } from "./policy.ts";
import { requireMaterialObject, requireMaterialObjectIdentity } from "./object.ts";
import { abortMaterialMultipart } from "./multipart.ts";
import { transitionMaterialTransfer } from "./transition.ts";
import { transferMaterialBytes } from "./stream";
import { completeMaterialTransfer } from "./complete";
import type { MaterialDecoders } from "./complete";
import type { TransferSnapshot } from "./transfer-state.ts";
import { canRevalidateMaterial } from "./transfer-state.ts";

export type MaterialRecovery = Readonly<{ id: string; materialId: string; version: number; state: TransferSnapshot["state"]; nextAction: "upload" | "cleanup" | "registered" | "new-upload" }>;

async function observeStoredWrite(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, current: StoredTransfer, object: R2Object, dispatchId: string, signal: AbortSignal): Promise<StoredTransfer> {
  requireMaterialObjectIdentity(object, current);
  const body = await readStorage("material.recover.read", () => bucket.get(current.objectKey, { onlyIf: { etagMatches: object.etag } }));
  if (body === null || !("body" in body)) throw materialFailure("material_storage_unavailable", "recovery-object-changed", 409);
  try {
    if (body.version !== object.version) throw materialFailure("material_storage_unavailable", "recovery-object-changed", 409);
    requireMaterialObjectIdentity(body, current);
  } catch (error: unknown) { await body.body.cancel(error); throw error; }
  const proof = await transferMaterialBytes(body.body, new WritableStream<Uint8Array>({ write(): void {} }), current.metadata, signal);
  const confirmed = await readStorage("material.recover.head", () => bucket.head(current.objectKey));
  if (confirmed === null || confirmed.version !== object.version || confirmed.etag !== object.etag) throw materialFailure("material_storage_unavailable", "recovery-object-changed", 409);
  return transitionMaterialTransfer(db, owner, current, { type: "write-succeeded", object: { objectVersion: object.version, etag: object.etag, sha256: proof.sha256, bytes: proof.bytes } }, dispatchId);
}

/** 결과 불명 쓰기는 실제 완료 객체 또는 multipart 중단으로 해결하며 시간만으로 부재를 확정하지 않습니다. */
async function settleMaterialWrite(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, current: StoredTransfer, dispatchId: string, signal: AbortSignal): Promise<StoredTransfer> {
  if (!["transferring", "unknown"].includes(current.snapshot.state)) return current;
  const object = await readStorage("material.recover.head", () => bucket.head(current.objectKey));
  if (object !== null) return observeStoredWrite(db, bucket, owner, current, object, dispatchId, signal);
  if (current.snapshot.multipartId === null) {
    // 본문 전송은 multipart ID의 D1 저장 뒤에만 가능하므로 CAS 취소가 늦은 본문 쓰기를 차단합니다.
    return transitionMaterialTransfer(db, owner, current, { type: "cancel-before-parts" }, dispatchId);
  }
  let abortError: unknown = null;
  try { await abortMaterialMultipart(bucket.resumeMultipartUpload(current.objectKey, current.snapshot.multipartId)); }
  catch (error: unknown) { abortError = error; }
  const afterAbort = await readStorage("material.recover.after-abort", () => bucket.head(current.objectKey));
  if (afterAbort !== null) return observeStoredWrite(db, bucket, owner, current, afterAbort, dispatchId, signal);
  if (abortError !== null) throw Object.assign(materialFailure("material_storage_unavailable", "multipart-abort-unconfirmed", 503), { cause: abortError });
  return transitionMaterialTransfer(db, owner, current, { type: "write-aborted", reason: "recovery-confirmed-abort-and-absence" }, dispatchId);
}

function recoveryResult(current: StoredTransfer, nextAction: MaterialRecovery["nextAction"]): MaterialRecovery {
  return { id: current.id, materialId: current.materialId, version: current.version, state: current.snapshot.state, nextAction };
}

/** 재개는 소유자의 동일 시도만 확인하고 등록 가능하면 기존 객체로 완료 검증을 이어갑니다. */
export async function recoverMaterialTransfer(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, id: string, expectedVersion: number, decoders: MaterialDecoders, requestSignal: AbortSignal): Promise<MaterialRecovery> {
  version.parse(expectedVersion);
  let current: StoredTransfer = await getMaterialTransfer(db, owner, id);
  if (current.snapshot.state === "registered") return recoveryResult(current, "registered");
  if (current.snapshot.state === "discarded") return recoveryResult(current, "new-upload");
  if (current.version !== expectedVersion) throw materialFailure("material_version_conflict", "recovery-state", 409);
  if (current.snapshot.state === "reserved") return recoveryResult(current, "upload");
  if (current.snapshot.state === "transferring" && Date.now() - current.snapshot.updatedAt < 60000) throw materialFailure("material_version_conflict", "transfer-in-progress", 409);
  const signal: AbortSignal = AbortSignal.any([requestSignal, AbortSignal.timeout(materialPolicy.recoveryTimeoutMs)]);
  current = await settleMaterialWrite(db, bucket, owner, current, crypto.randomUUID(), signal);
  if (["stored", "validating", "verified"].includes(current.snapshot.state) || canRevalidateMaterial(current.snapshot, current.metadata)) {
    await completeMaterialTransfer(db, bucket, owner, id, current.version, decoders, signal);
    return recoveryResult(await getMaterialTransfer(db, owner, id), "registered");
  }
  return recoveryResult(current, "cleanup");
}

async function deleteSettledObject(bucket: R2Bucket, current: StoredTransfer): Promise<void> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    const object = await readStorage("material.cleanup.head", () => bucket.head(current.objectKey));
    if (object === null) return;
    requireMaterialObject(object, current);
    try {
      await bucket.delete(current.objectKey);
      if (await readStorage("material.cleanup.absence", () => bucket.head(current.objectKey)) === null) return;
      throw materialFailure("material_storage_unavailable", "deleted-object-still-present", 503);
    } catch (error: unknown) {
      if (await readStorage("material.cleanup.reconcile", () => bucket.head(current.objectKey)) === null) return;
      if (attempt === 3) throw error;
      console.warn({ event: "material_delete_retry", transferId: current.id, attempt, errorType: error instanceof Error ? error.name : "unknown" });
      await new Promise<void>((resolve): void => { setTimeout(resolve, attempt * 100); });
    }
  }
}

/** 요청된 미확정 시도만 정리하며 실제 부재와 D1 취소가 확인돼야 예약을 해제합니다. */
export async function cleanupMaterialTransfer(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, id: string, expectedVersion: number, requestSignal: AbortSignal): Promise<MaterialRecovery> {
  version.parse(expectedVersion);
  let current: StoredTransfer = await getMaterialTransfer(db, owner, id);
  if (current.snapshot.state === "registered") throw materialFailure("material_access_required", "registered-file-cleanup-forbidden", 409);
  if (current.snapshot.state === "discarded") return recoveryResult(current, "new-upload");
  if (current.version !== expectedVersion) throw materialFailure("material_version_conflict", "cleanup-state", 409);
  const referenced: number | null = await readStorage("material.cleanup.references", () => db.prepare("SELECT COUNT(*) AS n FROM material_pages WHERE owner_id=? AND upload_id=?").bind(owner.userId, id).first<number>("n"));
  if (referenced !== 0) throw materialFailure("material_access_required", "referenced-file-cleanup-forbidden", 409);
  const signal: AbortSignal = AbortSignal.any([requestSignal, AbortSignal.timeout(materialPolicy.recoveryTimeoutMs)]);
  const dispatchId: string = crypto.randomUUID();
  current = await settleMaterialWrite(db, bucket, owner, current, dispatchId, signal);
  if (current.snapshot.state !== "cleaning") current = await transitionMaterialTransfer(db, owner, current, { type: "cleanup" }, dispatchId);
  signal.throwIfAborted();
  await deleteSettledObject(bucket, current);
  current = await transitionMaterialTransfer(db, owner, current, { type: "deleted" }, dispatchId);
  return recoveryResult(current, "new-upload");
}
