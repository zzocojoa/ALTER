import createPdfModule from "./pdf-wasm/validator.js";
import type { PdfModule, PdfNativeProof } from "./pdf-wasm/validator.js";
import { materialFailure, materialPolicy } from "./policy";

export type PdfRangeSource = Readonly<{ bytes: number; read: (offset: number, length: number, signal: AbortSignal) => Promise<Uint8Array> }>;
export type PdfStructureProof = PdfNativeProof & Readonly<{ kind: "pdf"; mime: "application/pdf"; maximumRangeBytes: number; wasmMemoryBytes: number; originalFileAccumulated: false; encodedImagePixelsDecoded: false }>;
function invalid(field: string): Error { return materialFailure("material_content_invalid", field, 422); }

/** 원본은 고정 Range로만 읽고 PDF 구조·페이지·일반 스트림을 검증합니다. 내장 이미지 픽셀 렌더링은 이 증거에 포함하지 않습니다. */
export async function validatePdfStructure(source: PdfRangeSource, signal: AbortSignal, compiled: WebAssembly.Module): Promise<PdfStructureProof> {
  if (!Number.isSafeInteger(source.bytes) || source.bytes < 8 || source.bytes > materialPolicy.types.pdf.maximumBytes) throw invalid("pdf:file-size");
  const combined: AbortSignal = AbortSignal.any([signal, AbortSignal.timeout(materialPolicy.validationTimeoutMs)]);
  let readCalls: number = 0;
  let readBytes: number = 0;
  let maximumRangeBytes: number = 0;
  let rangeError: unknown;
  let nativeError: string | null = null;
  let nativeProof: PdfNativeProof | null = null;
  async function readRange(offset: number, length: number): Promise<Uint8Array> {
    combined.throwIfAborted();
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1 || length > 65536 || offset + length > source.bytes) throw invalid("pdf:invalid-range");
    readCalls += 1; readBytes += length; maximumRangeBytes = Math.max(maximumRangeBytes, length);
    if (readCalls > 4098 || readBytes > 134218760) throw invalid("pdf:range-budget");
    const bytes: Uint8Array = await source.read(offset, length, combined);
    combined.throwIfAborted();
    if (bytes.byteLength !== length) throw invalid("pdf:range-length-mismatch");
    return bytes;
  }
  const head: Uint8Array = await readRange(0, 8);
  if (!/^%PDF-(?:1\.[0-7]|2\.0)$/.test(new TextDecoder().decode(head))) throw invalid("pdf:header");
  const tailLength: number = Math.min(1024, source.bytes);
  const tail: Uint8Array = await readRange(source.bytes - tailLength, tailLength);
  if (!/startxref[\x09\x0a\x0c\x0d\x20]+\d+[\x09\x0a\x0c\x0d\x20]+%%EOF[\x09\x0a\x0c\x0d\x20]*$/.test(new TextDecoder().decode(tail))) throw invalid("pdf:eof");
  const runtime: PdfModule = await createPdfModule({
    instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, compiledModule: WebAssembly.Module) => void): WebAssembly.Exports { const instance: WebAssembly.Instance = new WebAssembly.Instance(compiled, imports); receive(instance, compiled); return instance.exports; },
    readRange,
    rangeFailure(error: unknown): void { rangeError = error; },
    failure(message: string): void { nativeError = message.slice(0, 512); },
    complete(proof: PdfNativeProof): void { nativeProof = proof; },
  });
  const status: number = await runtime.ccall("alter_pdf_validate", "number", ["number"], [source.bytes], { async: true });
  if (rangeError !== undefined) throw rangeError;
  if (status !== 0 || nativeProof === null) throw invalid(nativeError ?? "pdf:missing-structure-proof");
  combined.throwIfAborted();
  const proof: PdfNativeProof = nativeProof;
  if (runtime.HEAPU8.byteLength > 67108864) throw invalid("pdf:wasm-memory-limit");
  return { ...(proof as PdfNativeProof), kind: "pdf", mime: "application/pdf", rangeReads: readCalls, rangeBytes: readBytes, maximumRangeBytes, wasmMemoryBytes: runtime.HEAPU8.byteLength, originalFileAccumulated: false, encodedImagePixelsDecoded: false };
}
