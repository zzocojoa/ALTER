import { createCheckedByteStream } from "../materials/checked-stream.ts";
import type { ByteExpectation, CheckedStreamProof } from "../materials/checked-stream.ts";
import { backupFailure } from "./contracts.ts";
import { readStorage } from "../../db/repositories/atomic.ts";
import { requireRestoredOriginalIdentity, restoreOriginalMetadata } from "./restore-original.ts";
import type { RestoreOriginalPlan } from "./restore-original.ts";

/** 스트리밍 SHA-256 검증이 끝나야 마지막 바이트와 EOF가 R2에 전달됩니다. 전체 원본 버퍼를 만들지 않습니다. */
export async function putCheckedRestoreOriginal(bucket: R2Bucket, key: string, source: ReadableStream<Uint8Array>, expected: ByteExpectation, options: R2PutOptions, signal: AbortSignal): Promise<R2Object | null> {
  const stop: AbortController = new AbortController(); const combined: AbortSignal = AbortSignal.any([signal, stop.signal]);
  const checked = createCheckedByteStream(source, expected, combined, async (): Promise<void> => {});
  const bridge: FixedLengthStream = new FixedLengthStream(expected.bytes);
  const results = await Promise.allSettled([
    checked.pipeTo(bridge.writable, { signal: combined }),
    bucket.put(key, bridge.readable, options).then((object: R2Object | null): R2Object | null => { if (object === null) stop.abort(backupFailure("object-changed", "restore.concurrent-original")); return object; }).catch((error: unknown): never => { stop.abort(error); throw error; }),
  ]);
  const [stream, put] = results;
  if (put.status === "rejected") throw put.reason;
  if (put.value === null) return null;
  if (stream.status === "rejected") throw stream.reason;
  return put.value;
}
/** 저장 후 원본을 제한 버퍼로 다시 읽어 실제 해시와 버전을 대조합니다. HEAD 메타데이터만으로 완료시키지 않습니다. */
export async function verifyRestoredOriginal(bucket: R2Bucket, runId: string, plan: RestoreOriginalPlan, signal: AbortSignal): Promise<Readonly<{ object: R2Object; proof: CheckedStreamProof }>> {
  const object = await readStorage("restore.original-get", () => bucket.get(plan.entry.objectKey));
  if (object === null) throw backupFailure("invalid-object", "restore.original-missing");
  try { requireRestoredOriginalIdentity(object, runId, plan); }
  catch (error: unknown) { await object.body.cancel(error); throw error; }
  let proof: CheckedStreamProof | null = null;
  const checked = createCheckedByteStream(object.body, plan.entry, signal, async result => { proof = result; });
  await checked.pipeTo(new WritableStream<Uint8Array>({ write(): void {} }), { signal });
  const current = await readStorage("restore.original-head", () => bucket.head(plan.entry.objectKey));
  if (current === null || proof === null || current.version !== object.version || current.etag !== object.etag) throw backupFailure("object-changed", "restore.original-after-read");
  requireRestoredOriginalIdentity(current, runId, plan); return { object: current, proof };
}
/** 동일 키에 대한 조건부 쓰기만 허용합니다. 쓰기 응답이 없어도 재읽기 검증을 통과한 원본만 인정합니다. */
export async function receiveOriginalBytes(bucket: R2Bucket, runId: string, plan: RestoreOriginalPlan, request: Pick<Request, "body" | "signal">): Promise<Awaited<ReturnType<typeof verifyRestoredOriginal>>> {
  if (request.body === null) throw backupFailure("invalid-object", "restore.original-body");
  const signal: AbortSignal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
  const prior = await readStorage("restore.original-before-write", () => bucket.head(plan.entry.objectKey));
  if (prior !== null) { await request.body.cancel(); return verifyRestoredOriginal(bucket, runId, plan, signal); }
  try { await putCheckedRestoreOriginal(bucket, plan.entry.objectKey, request.body, plan.entry, restoreOriginalMetadata(runId, plan), signal); }
  catch (error: unknown) {
    console.warn({ event: "restore_original_write_unconfirmed", operation: "conditional-put", runId, uploadId: plan.entry.uploadId, errorType: error instanceof Error ? error.name : "unknown" });
    if (!request.body.locked) await request.body.cancel(error);
    const observed = await readStorage("restore.original-write-reconcile", () => bucket.head(plan.entry.objectKey));
    if (observed === null) throw error;
    try { return await verifyRestoredOriginal(bucket, runId, plan, signal); }
    catch (verificationError: unknown) { throw new AggregateError([error, verificationError], "원본 쓰기 결과를 확인하지 못했습니다. 기존 예약을 유지하고 같은 파일로 재개하세요."); }
  }
  return verifyRestoredOriginal(bucket, runId, plan, signal);
}
