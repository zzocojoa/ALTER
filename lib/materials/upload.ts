import { recordId, version } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { getMaterialTransfer } from "../../db/repositories/material-transfers.ts";
import type { StoredTransfer } from "../../db/repositories/material-transfers.ts";
import { transitionMaterialTransfer } from "./transition.ts";
import { materialFailure } from "./policy.ts";
import { requireMaterialTransferBody } from "./request.ts";
import { openMaterialBody } from "./signature.ts";
import { abortMaterialMultipart } from "./multipart.ts";
import { transferMaterialBytes } from "./stream.ts";
import type { MaterialStreamProof } from "./stream.ts";

export type MaterialUploadProof = Readonly<{ id: string; materialId: string; version: number; state: "stored"; transfer: MaterialStreamProof }>;
export type MaterialUploadBucket = Pick<R2Bucket, "createMultipartUpload">;
type UploadStage = "claiming" | "creating-multipart" | "recording-multipart" | "uploading-part" | "completing" | "recording-object";

/** 단일 제한 크기의 multipart를 스트리밍하며 완료 전 해시·실제 길이를 검증합니다. */
export async function uploadMaterialBody(db: D1Database, bucket: MaterialUploadBucket, owner: SiteIdentity, id: string, expectedVersion: number, request: Readonly<Pick<Request, "headers" | "body" | "signal">>): Promise<MaterialUploadProof> {
  recordId.parse(id); version.parse(expectedVersion);
  let current: StoredTransfer = await getMaterialTransfer(db, owner, id);
  if (current.version !== expectedVersion || current.snapshot.state !== "reserved") throw materialFailure("material_version_conflict", "upload-state", 409);
  requireMaterialTransferBody(request, current.metadata);
  if (request.body === null) throw materialFailure("material_body_length_invalid", "body", 400);
  const stop: AbortController = new AbortController();
  const signal: AbortSignal = AbortSignal.any([request.signal, stop.signal, AbortSignal.timeout(60000)]);
  const source: ReadableStream<Uint8Array> = await openMaterialBody(request.body, current.metadata, signal);
  const dispatchId: string = crypto.randomUUID();
  let upload: R2MultipartUpload | null = null;
  let stage: UploadStage = "claiming";
  try {
    current = await transitionMaterialTransfer(db, owner, current, { type: "start" }, dispatchId);
    signal.throwIfAborted(); stage = "creating-multipart";
    upload = await bucket.createMultipartUpload(current.objectKey, { httpMetadata: { contentType: current.metadata.mime }, customMetadata: { alterTransferId: current.id, alterUploadId: current.uploadId, alterSha256: current.metadata.sha256, alterMaterialId: current.materialId } });
    stage = "recording-multipart";
    current = await transitionMaterialTransfer(db, owner, current, { type: "multipart-created", multipartId: upload.uploadId }, dispatchId);
    signal.throwIfAborted(); stage = "uploading-part";
    const bridge: FixedLengthStream = new FixedLengthStream(current.metadata.bytes);
    const results = await Promise.allSettled([
      transferMaterialBytes(source, bridge.writable, current.metadata, signal),
      upload.uploadPart(1, bridge.readable).catch((error: unknown): never => { stop.abort(error); throw error; }),
    ]);
    const [transfer, part] = results;
    if (transfer.status === "rejected") throw transfer.reason;
    if (part.status === "rejected") throw part.reason;
    signal.throwIfAborted(); stage = "completing";
    const object: R2Object = await upload.complete([part.value]);
    stage = "recording-object";
    if (object.key !== current.objectKey || object.size !== transfer.value.bytes) throw materialFailure("material_storage_unavailable", "completed-object-mismatch", 503);
    current = await transitionMaterialTransfer(db, owner, current, { type: "write-succeeded", object: { objectVersion: object.version, etag: object.etag, sha256: transfer.value.sha256, bytes: transfer.value.bytes } }, dispatchId);
    return { id: current.id, materialId: current.materialId, version: current.version, state: "stored", transfer: transfer.value };
  } catch (error: unknown) {
    console.warn({ event: "material_upload_failed", transferId: id, stage, writeOutcomeUnconfirmed: ["creating-multipart", "completing", "recording-object"].includes(stage), errorType: error instanceof Error ? error.name : "unknown" });
    let cancellationError: unknown = null;
    if (!source.locked) {
      try { await source.cancel(error); }
      catch (cleanupError: unknown) { if (cleanupError !== error) cancellationError = cleanupError; }
    }
    if (stage === "claiming") {
      if (cancellationError !== null) throw new AggregateError([error, cancellationError], "자료 선점 실패 후 입력 정리도 실패했습니다.");
      throw error;
    }
    try {
      if (upload !== null && current.snapshot.multipartId !== null && stage === "uploading-part") {
        await abortMaterialMultipart(upload);
        await transitionMaterialTransfer(db, owner, current, { type: "write-aborted", reason: "part-or-stream-failed-abort-confirmed" }, dispatchId);
      } else {
        await transitionMaterialTransfer(db, owner, current, { type: "write-unknown", reason: stage }, dispatchId);
      }
    } catch (preservationError: unknown) { throw new AggregateError([error, preservationError], "자료 전송 실패와 결과 기록을 함께 확인하지 못했습니다. 같은 업로드 ID의 상태를 조회하고 예약을 유지해야 합니다."); }
    if (cancellationError !== null) throw new AggregateError([error, cancellationError], "자료 전송 실패 상태는 보존했지만 입력 정리를 확인하지 못했습니다.");
    throw error;
  }
}
