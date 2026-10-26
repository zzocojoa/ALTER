import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import { materialFailure, materialPolicy } from "./policy.ts";

export type CheckedStreamProof = Readonly<{ bytes: number; sha256: string; maximumReadBytes: number; maximumReadBufferBytes: number }>;
export type ByteExpectation = Readonly<{ bytes: number; sha256: string }>;

/** 원본은 BYOB 64KiB로 읽고 최종 검증 전에는 마지막 조각과 EOF를 보류합니다. 마지막 조각과 다음 읽기에 각각 최대 64KiB를 씁니다. */
export function createCheckedByteStream(source: ReadableStream<Uint8Array>, expected: ByteExpectation, signal: AbortSignal, onVerified: (proof: CheckedStreamProof) => Promise<void>): ReadableStream<Uint8Array> {
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || !/^[a-f0-9]{64}$/.test(expected.sha256)) throw materialFailure("material_metadata_invalid", "stream-expectation", 400);
  let reader: ReadableStreamBYOBReader;
  try { reader = source.getReader({ mode: "byob" }); }
  catch (error: unknown) { if (!(error instanceof TypeError)) throw error; throw Object.assign(materialFailure("material_stream_unsupported", "byte-stream", 503), { cause: error }); }
  const digest: Hash = createHash("sha256");
  let received: number = 0; let maximumReadBytes: number = 0; let maximumReadBufferBytes: number = 0; let finished: boolean = false;
  let detachAbort: () => void = (): void => {};
  async function fail(controller: ReadableByteStreamController, reason: unknown): Promise<void> {
    if (finished) return;
    finished = true; detachAbort();
    let failure: unknown = reason;
    try { await reader.cancel(reason); }
    catch (cleanupError: unknown) { if (cleanupError !== reason) failure = new AggregateError([reason, cleanupError], "원본 스트림 실패 후 정리도 실패했습니다."); }
    finally { reader.releaseLock(); }
    controller.error(failure);
  }
  return new ReadableStream({
    type: "bytes",
    start(controller: ReadableByteStreamController): void {
      const abort = (): void => { void fail(controller, signal.reason); };
      detachAbort = (): void => signal.removeEventListener("abort", abort);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    },
    async pull(controller: ReadableByteStreamController): Promise<void> {
      try {
        signal.throwIfAborted();
        const chunk = await reader.read(new Uint8Array(materialPolicy.streamChunkBytes));
        if (finished) return;
        signal.throwIfAborted();
        if (chunk.done) {
          throw materialFailure("material_body_length_invalid", `actual-bytes:${received}/expected-bytes:${expected.bytes}`, 400);
        }
        if (received + chunk.value.byteLength > expected.bytes) throw materialFailure("material_body_length_invalid", `actual-bytes-at-least:${received + chunk.value.byteLength}/expected-bytes:${expected.bytes}`, 400);
        received += chunk.value.byteLength; maximumReadBytes = Math.max(maximumReadBytes, chunk.value.byteLength); maximumReadBufferBytes = Math.max(maximumReadBufferBytes, chunk.value.buffer.byteLength);
        digest.update(chunk.value);
        if (received === expected.bytes) {
          const tail = await reader.read(new Uint8Array(materialPolicy.streamChunkBytes));
          if (finished) return;
          signal.throwIfAborted();
          if (!tail.done) throw materialFailure("material_body_length_invalid", `actual-bytes-at-least:${received + tail.value.byteLength}/expected-bytes:${expected.bytes}`, 400);
          const sha256: string = digest.digest("hex");
          if (sha256 !== expected.sha256) throw materialFailure("material_checksum_mismatch", "sha256", 422);
          await onVerified({ bytes: received, sha256, maximumReadBytes, maximumReadBufferBytes });
          if (finished) return;
          signal.throwIfAborted(); finished = true; detachAbort(); reader.releaseLock();
          controller.enqueue(chunk.value); controller.close(); return;
        }
        controller.enqueue(chunk.value);
      } catch (error: unknown) { await fail(controller, error); }
    },
    async cancel(reason: unknown): Promise<void> {
      if (finished) return;
      finished = true; detachAbort();
      try { await reader.cancel(reason); } finally { reader.releaseLock(); }
    },
  });
}
