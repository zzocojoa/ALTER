import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import createJpegModule from "./jpeg-wasm/decoder.js";
import type { JpegModule } from "./jpeg-wasm/decoder.js";
import { materialFailure, materialPolicy } from "./policy";
import type { MaterialMetadata } from "./policy";
import { transferMaterialBytes } from "./stream";
import type { MaterialStreamProof } from "./stream";
import { readJpegContainer } from "./jpeg-container";

export type JpegPixelProof = Readonly<{ width: number; height: number; pixels: number; scanlines: number; decodedBytes: number; maximumRowBytes: number; maximumInputWindowBytes: number; wasmMemoryBytes: number; coefficientBytes: number; progressive: boolean; scanlineSha256: string }>;
export type JpegContentProof = Readonly<{ kind: "image"; mime: "image/jpeg"; pages: 1; transfer: MaterialStreamProof; image: JpegPixelProof; auxiliary?: JpegPixelProof }>;
function invalid(field: string): Error { return materialFailure("material_content_invalid", `jpeg:${field}`, 422); }
function decoderError(runtime: JpegModule, decoder: number): Error {
  const start: number = runtime._alter_jpeg_error(decoder);
  const end: number = runtime.HEAPU8.indexOf(0, start);
  if (end < start || end > start + 256) return invalid("decoder-error-buffer");
  return invalid(new TextDecoder().decode(runtime.HEAPU8.subarray(start, end)));
}

/** 입력은 고정 64KiB 창으로 공급하고 픽셀은 한 행씩 해시합니다. WASM 자체도 최대 64MiB로 제한합니다. */
async function decodeJpeg(source: ReadableStream<Uint8Array>, runtime: JpegModule, signal: AbortSignal): Promise<JpegPixelProof> {
  const decoder: number = runtime._alter_jpeg_create();
  if (decoder === 0) throw invalid("decoder-allocation");
  const reader: ReadableStreamDefaultReader<Uint8Array> = source.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  let offset: number = 0;
  let ended: boolean = false;
  let scanlines: number = 0;
  let decodedBytes: number = 0;
  const digest: Hash = createHash("sha256");
  async function next(): Promise<boolean> {
    if (offset < pending.byteLength) return true;
    const part = await reader.read();
    if (part.done) { ended = true; return false; }
    if (part.value.byteLength > materialPolicy.streamChunkBytes) throw invalid("input-chunk-limit");
    pending = part.value; offset = 0;
    return true;
  }
  try {
    for (;;) {
      signal.throwIfAborted();
      const result: number = runtime._alter_jpeg_step(decoder);
      if (result < 0) throw decoderError(runtime, decoder);
      if (runtime.HEAPU8.byteLength > 67108864) throw invalid("wasm-memory-limit");
      if (result === 1) {
        const size: number = runtime._alter_jpeg_row_bytes(decoder);
        const start: number = runtime._alter_jpeg_row(decoder);
        digest.update(runtime.HEAPU8.subarray(start, start + size));
        scanlines += 1; decodedBytes += size;
        continue;
      }
      if (result === 2) {
        if (!ended && await next()) throw invalid("trailing-bytes");
        const width: number = runtime._alter_jpeg_width(decoder);
        const height: number = runtime._alter_jpeg_height(decoder);
        if (scanlines !== height) throw invalid("scanline-count");
        return { width, height, pixels: width * height, scanlines, decodedBytes, maximumRowBytes: runtime._alter_jpeg_row_bytes(decoder), maximumInputWindowBytes: runtime._alter_jpeg_retained(decoder), wasmMemoryBytes: runtime.HEAPU8.byteLength, coefficientBytes: runtime._alter_jpeg_coefficients(decoder), progressive: runtime._alter_jpeg_progressive(decoder) === 1, scanlineSha256: digest.digest("hex") };
      }
      if (ended) throw invalid("unexpected-eof");
      if (!await next()) {
        if (runtime._alter_jpeg_end(decoder) < 0) throw decoderError(runtime, decoder);
        continue;
      }
      const capacity: number = runtime._alter_jpeg_space(decoder);
      if (capacity < 1) throw invalid("input-window-limit");
      const count: number = Math.min(capacity, pending.byteLength - offset);
      runtime.HEAPU8.set(pending.subarray(offset, offset + count), runtime._alter_jpeg_incoming(decoder));
      if (runtime._alter_jpeg_feed(decoder, count) < 0) throw decoderError(runtime, decoder);
      offset += count;
    }
  } finally {
    runtime._alter_jpeg_destroy(decoder);
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

/** MPF가 명시한 보조 JPEG도 같은 WASM 메모리에서 디코딩하며 원본의 남은 바이트를 버리지 않습니다. */
async function decodeJpegImages(source: ReadableStream<Uint8Array>, compiled: WebAssembly.Module, signal: AbortSignal, bytes: number): Promise<Readonly<{ image: JpegPixelProof; auxiliary?: JpegPixelProof }>> {
  const runtime: JpegModule = await createJpegModule({ instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, compiledModule: WebAssembly.Module) => void): WebAssembly.Exports {
    const instance: WebAssembly.Instance = new WebAssembly.Instance(compiled, imports);
    receive(instance, compiled); return instance.exports;
  } });
  const container = readJpegContainer(source, signal);
  try {
    const primary = container.frame();
    const image: JpegPixelProof = await decodeJpeg(primary.body, runtime, signal);
    const facts = primary.facts();
    if (facts.mpf === null) { await container.requireEnd(); return { image }; }
    if (facts.end !== facts.mpf.primaryBytes || facts.mpf.primaryBytes + facts.mpf.auxiliaryBytes !== bytes) throw invalid("mpf-image-boundary");
    const secondary = container.frame();
    const auxiliary: JpegPixelProof = await decodeJpeg(secondary.body, runtime, signal);
    const secondaryFacts = secondary.facts();
    if (secondaryFacts.mpf !== null || secondaryFacts.start !== facts.mpf.auxiliaryOffset || secondaryFacts.end !== bytes) throw invalid("mpf-image-boundary");
    if (image.pixels + auxiliary.pixels > materialPolicy.types.image.maximumPixels) throw invalid("mpf-total-pixel-limit");
    await container.requireEnd();
    return { image, auxiliary };
  } finally { await container.close(); }
}

/** 전송 길이·SHA-256과 전체 JPEG 디코딩이 모두 성공해야 내용 증거를 반환합니다. */
export async function validateJpegContent(source: ReadableStream<Uint8Array>, metadata: MaterialMetadata, signal: AbortSignal, compiled: WebAssembly.Module): Promise<JpegContentProof> {
  if (metadata.kind !== "image" || metadata.mime !== "image/jpeg") throw materialFailure("material_type_mismatch", "jpeg-validator-kind", 415);
  const stop: AbortController = new AbortController();
  const combined: AbortSignal = AbortSignal.any([signal, stop.signal]);
  const bridge: TransformStream<Uint8Array, Uint8Array> = new TransformStream();
  const outcomes = await Promise.allSettled([
    transferMaterialBytes(source, bridge.writable, metadata, combined),
    decodeJpegImages(bridge.readable, compiled, combined, metadata.bytes).catch((error: unknown): never => { stop.abort(error); throw error; }),
  ]);
  const [transfer, image] = outcomes;
  if (image.status === "rejected") throw image.reason;
  if (transfer.status === "rejected") throw transfer.reason;
  return { kind: "image", mime: "image/jpeg", pages: 1, transfer: transfer.value, ...image.value };
}
