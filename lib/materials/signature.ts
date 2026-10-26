import { materialFailure, materialPolicy } from "./policy.ts";
import type { MaterialMetadata } from "./policy.ts";

/** 최소 시그니처 검사이며 정상 디코딩·전체 구조 검증을 대신하지 않습니다. */
export function requireMaterialSignature(prefix: Uint8Array, metadata: MaterialMetadata): void {
  if (metadata.kind === "pdf" && !/^%PDF-(?:1\.[0-7]|2\.0)$/.test(new TextDecoder().decode(prefix.subarray(0, 8)))) throw materialFailure("material_type_mismatch", "pdf-signature", 415);
  if (metadata.mime === "image/png" && (prefix.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte: number, index: number): boolean => prefix[index] === byte))) throw materialFailure("material_type_mismatch", "png-signature", 415);
  if (metadata.mime === "image/jpeg" && (prefix.length < 3 || prefix[0] !== 255 || prefix[1] !== 216 || prefix[2] !== 255)) throw materialFailure("material_type_mismatch", "jpeg-signature", 415);
  if (metadata.kind === "text") {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(prefix, { stream: prefix.length < metadata.bytes }); }
    catch (error: unknown) { if (error instanceof TypeError) throw materialFailure("material_type_mismatch", "text-signature-utf8", 415); throw error; }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw materialFailure("material_type_mismatch", "text-signature-control", 415);
  }
}

/** 처음 8바이트만 먼저 확인하고 같은 바이트를 후속 스트림에 전달합니다. */
export async function openMaterialBody(source: ReadableStream<Uint8Array>, metadata: MaterialMetadata, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  let reader: ReadableStreamBYOBReader;
  try { reader = source.getReader({ mode: "byob" }); }
  catch (error: unknown) { if (error instanceof TypeError) throw materialFailure("material_stream_unsupported", "byte-stream", 503); throw error; }
  const abort = (): void => { void reader.cancel(signal.reason).catch((error: unknown): void => { console.warn({ event: "material_signature_cancel_failed", errorType: error instanceof Error ? error.name : "unknown" }); }); };
  signal.addEventListener("abort", abort, { once: true });
  const release = (): void => { signal.removeEventListener("abort", abort); reader.releaseLock(); };
  let prefix: Uint8Array = new Uint8Array(8);
  let read: number = 0;
  try {
    signal.throwIfAborted();
    while (read < Math.min(8, metadata.bytes)) {
      const part = await reader.read(new Uint8Array(Math.min(8, metadata.bytes) - read));
      signal.throwIfAborted();
      if (part.done) throw materialFailure("material_body_length_invalid", "signature-short-body", 400);
      prefix.set(part.value, read); read += part.value.length;
    }
    prefix = prefix.slice(0, read);
    requireMaterialSignature(prefix, metadata);
  } catch (error: unknown) {
    try { await reader.cancel(error); } finally { release(); }
    throw error;
  }
  let sentPrefix: boolean = false;
  return new ReadableStream({
    type: "bytes",
    async pull(controller: ReadableByteStreamController): Promise<void> {
      try {
        signal.throwIfAborted();
        if (!sentPrefix) { sentPrefix = true; controller.enqueue(prefix); return; }
        const part = await reader.read(new Uint8Array(materialPolicy.streamChunkBytes));
        signal.throwIfAborted();
        if (part.done) { controller.close(); controller.byobRequest?.respond(0); release(); return; }
        controller.enqueue(part.value);
      } catch (error: unknown) { release(); controller.error(error); }
    },
    async cancel(reason: unknown): Promise<void> { try { await reader.cancel(reason); } finally { release(); } },
  });
}
