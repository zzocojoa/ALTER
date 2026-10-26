import { materialFailure } from "./policy";
import type { PdfRangeSource } from "./pdf-content";

/** 특정 객체 버전에 고정하여 최대 64KiB만 읽고 조건 불일치를 명시적으로 거부합니다. */
export function pdfR2Source(bucket: R2Bucket, key: string, saved: Readonly<{ size: number; etag: string; version: string }>): PdfRangeSource {
  return { bytes: saved.size, async read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > 65536 || offset + length > saved.size) throw materialFailure("material_content_invalid", "pdf:invalid-range", 422);
    for (let attempt: number = 1; attempt <= 3; attempt += 1) {
      signal.throwIfAborted();
      try {
        const object: R2ObjectBody | R2Object | null = await bucket.get(key, { range: { offset, length }, onlyIf: { etagMatches: saved.etag } });
        if (object === null || !("body" in object)) throw materialFailure("material_storage_unavailable", "pdf:object-missing-or-changed", 409);
        if (object.etag !== saved.etag || object.version !== saved.version || object.size !== saved.size || object.range === undefined || !("offset" in object.range) || !("length" in object.range) || object.range.offset !== offset || object.range.length !== length) {
          await object.body.cancel();
          throw materialFailure("material_storage_unavailable", "pdf:range-version-mismatch", 409);
        }
        const bytes: Uint8Array = new Uint8Array(await object.arrayBuffer());
        if (bytes.byteLength !== length) throw materialFailure("material_storage_unavailable", "pdf:range-length-mismatch", 503);
        signal.throwIfAborted();
        return bytes;
      } catch (error: unknown) {
        if (signal.aborted || error instanceof Error && error.name === "MaterialFailure" || attempt === 3) throw error;
        console.warn({ event: "pdf_range_retry", key, offset, length, attempt, errorType: error instanceof Error ? error.name : "unknown" });
        await new Promise<void>((resolve) => setTimeout(resolve, attempt * 100));
      }
    }
    throw new Error("PDF Range 재시도 범위를 벗어났습니다.");
  } };
}
