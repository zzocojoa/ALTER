import { domainFailure } from "./domain/contracts.ts";
import type { Command } from "./domain/contracts.ts";
import { createPrivateObject, readPrivateObject } from "./r2-access.ts";
import { reserveUpload, recordUploadObservation, uploadObjectKey, reconcileUpload } from "../db/repositories/materials.ts";
import type { UploadInput, UploadObservation } from "../db/repositories/materials.ts";
import type { Receipt } from "../db/repositories/atomic.ts";

export async function hashFile(data: ArrayBuffer): Promise<string> {
  const digest: ArrayBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte: number): string => byte.toString(16).padStart(2, "0")).join("");
}

/** D1 예약 → 조건부 R2 생성 → 내용 재조회 → D1 확인 순서이며 실패 객체를 자동 삭제하지 않습니다. */
export async function storeLearningUpload(db: D1Database, bucket: R2Bucket, reserveContext: Command, verifyContext: Command, input: UploadInput, data: ArrayBuffer): Promise<Receipt> {
  if (reserveContext.owner.userId !== verifyContext.owner.userId || input.bytes !== data.byteLength || input.expectedHash !== await hashFile(data)) throw domainFailure("validation", "upload.store", null);
  await reserveUpload(db, reserveContext, input);
  const key: string = uploadObjectKey(input);
  await createPrivateObject(bucket, key, data);
  return recoverLearningUpload(db, bucket, verifyContext, input);
}

/** 재시도는 동일 업로드의 실제 내용부터 확인하며 객체와 메타데이터 중 한쪽만 있는 경우를 구분합니다. */
export async function recoverLearningUpload(db: D1Database, bucket: R2Bucket, context: Command, input: UploadInput): Promise<Receipt> {
  const key: string = uploadObjectKey(input);
  const object: R2ObjectBody | null = await readPrivateObject(bucket, key);
  const observed: UploadObservation = object === null ? null : { objectKey: object.key, uploadId: input.uploadId, hash: await hashFile(await object.arrayBuffer()), bytes: object.size };
  const result = reconcileUpload(input, observed);
  const receipt: Receipt = await recordUploadObservation(db, context, input, observed);
  if (result.state !== "verified") throw domainFailure("reference_conflict", "upload.recover", null);
  return receipt;
}
