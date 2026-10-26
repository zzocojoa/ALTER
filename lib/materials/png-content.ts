import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflate } from "node:zlib";
import type { Hash } from "node:crypto";
import type { Inflate } from "node:zlib";
import { materialFailure, materialPolicy } from "./policy";
import type { MaterialMetadata } from "./policy";
import { transferMaterialBytes } from "./stream";
import type { MaterialStreamProof } from "./stream";

export type PngHeader = Readonly<{ width: number; height: number; depth: number; color: number; channels: number; interlace: number }>;
export type PngPixelProof = Readonly<{ width: number; height: number; pixels: number; scanlines: number; decodedBytes: number; maximumRowBytes: number; maximumInflateChunkBytes: number; scanlineSha256: string }>;
export type PngContentProof = Readonly<{ kind: "image"; mime: "image/png"; pages: 1; transfer: MaterialStreamProof; image: PngPixelProof }>;
type ByteCursor = Readonly<{ read: (length: number) => Promise<Uint8Array>; end: () => Promise<void>; close: () => Promise<void> }>;
type ChunkHeader = Readonly<{ length: number; name: string; typeBytes: Uint8Array }>;
type PngData = Readonly<{ chunks: AsyncGenerator<Uint8Array>; paletteSize: () => number; compressedBytes: () => number }>;
type ImagePass = Readonly<{ width: number; height: number; rowBytes: number }>;
const maximumRowBytes: number = 262144;
const maximumChunks: number = 4096;
const maximumScanlines: number = 65536;

function invalid(field: string): Error { return materialFailure("material_content_invalid", `png:${field}`, 422); }
function uint32(bytes: Uint8Array, offset: number): number { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false); }

/** CRC 상태를 값으로 전달하므로 입력 바이트와 공유 상태를 바꾸지 않습니다. */
export function pngCrc(bytes: Uint8Array, previous: number): number {
  let crc: number = previous;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit: number = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
}

/** 검증된 입력 청크 하나만 보유하며 호출자가 요청한 작은 구간만 복사합니다. */
function byteCursor(source: ReadableStream<Uint8Array>): ByteCursor {
  const reader: ReadableStreamDefaultReader<Uint8Array> = source.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  let offset: number = 0;
  async function next(): Promise<boolean> {
    if (offset < pending.byteLength) return true;
    const part = await reader.read();
    if (part.done) return false;
    pending = part.value; offset = 0;
    return true;
  }
  return {
    async read(length: number): Promise<Uint8Array> {
      if (!Number.isSafeInteger(length) || length < 0 || length > materialPolicy.streamChunkBytes) throw new RangeError("PNG 단일 읽기 요청이 64KiB 범위를 벗어났습니다.");
      const result: Uint8Array = new Uint8Array(length);
      let copied: number = 0;
      while (copied < length) {
        if (!await next()) throw invalid("unexpected-eof");
        const count: number = Math.min(length - copied, pending.byteLength - offset);
        result.set(pending.subarray(offset, offset + count), copied);
        copied += count; offset += count;
      }
      return result;
    },
    async end(): Promise<void> { if (await next()) throw invalid("trailing-bytes"); },
    async close(): Promise<void> { try { await reader.cancel(); } finally { reader.releaseLock(); } },
  };
}

async function chunkHeader(cursor: ByteCursor): Promise<ChunkHeader> {
  const bytes: Uint8Array = await cursor.read(8);
  const length: number = uint32(bytes, 0);
  const typeBytes: Uint8Array = bytes.slice(4);
  const name: string = String.fromCharCode(...typeBytes);
  if (length > materialPolicy.types.image.maximumBytes || !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(name)) throw invalid("chunk-header");
  return { length, name, typeBytes };
}
async function checkCrc(cursor: ByteCursor, crc: number): Promise<void> {
  if (uint32(await cursor.read(4), 0) !== ((crc ^ 0xffffffff) >>> 0)) throw invalid("crc");
}

function imagePasses(header: PngHeader): readonly ImagePass[] {
  const coordinates: readonly (readonly [number, number, number, number])[] = header.interlace === 0 ? [[0, 0, 1, 1]] : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  return coordinates.map(([x, y, dx, dy]): ImagePass => {
    const width: number = Math.max(0, Math.ceil((header.width - x) / dx));
    const height: number = Math.max(0, Math.ceil((header.height - y) / dy));
    return { width, height, rowBytes: Math.ceil(width * header.channels * header.depth / 8) };
  }).filter((pass: ImagePass): boolean => pass.width > 0 && pass.height > 0);
}

async function readHeader(cursor: ByteCursor): Promise<PngHeader> {
  const signature: Uint8Array = await cursor.read(8);
  if (!signature.every((byte: number, index: number): boolean => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])) throw invalid("signature");
  const chunk: ChunkHeader = await chunkHeader(cursor);
  if (chunk.name !== "IHDR" || chunk.length !== 13) throw invalid("ihdr");
  const bytes: Uint8Array = await cursor.read(13);
  await checkCrc(cursor, pngCrc(bytes, pngCrc(chunk.typeBytes, 0xffffffff)));
  const width: number = uint32(bytes, 0);
  const height: number = uint32(bytes, 4);
  const depth: number = bytes[8];
  const color: number = bytes[9];
  const channels: number = color === 0 || color === 3 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : 0;
  const depths: readonly number[] = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
  if (width < 1 || height < 1 || width * height > materialPolicy.types.image.maximumPixels) throw invalid("pixel-limit");
  if (channels === 0 || !depths.includes(depth) || bytes[10] !== 0 || bytes[11] !== 0 || bytes[12] > 1) throw invalid("ihdr-format");
  const header: PngHeader = { width, height, depth, color, channels, interlace: bytes[12] };
  const passes: readonly ImagePass[] = imagePasses(header);
  if (passes.some((pass: ImagePass): boolean => pass.rowBytes > maximumRowBytes)) throw invalid("row-memory-limit");
  if (passes.reduce((total: number, pass: ImagePass): number => total + pass.height, 0) > maximumScanlines) throw invalid("scanline-limit");
  return header;
}

/** PNG의 단일 zlib 스트림을 순차 공급하며 압축 데이터·원본을 누적하지 않습니다. */
function imageData(cursor: ByteCursor, header: PngHeader): PngData {
  let paletteEntries: number = 0;
  let inputBytes: number = 0;
  async function* chunks(): AsyncGenerator<Uint8Array> {
  let phase: "before" | "data" | "after" = "before";
  let seenPalette: boolean = false;
  let seenTransparency: boolean = false;
  for (let number: number = 1; number < maximumChunks; number += 1) {
    const chunk: ChunkHeader = await chunkHeader(cursor);
    let crc: number = pngCrc(chunk.typeBytes, 0xffffffff);
    if (chunk.name === "IHDR" || ["acTL", "fcTL", "fdAT"].includes(chunk.name)) throw invalid("duplicate-header-or-animation");
    if (chunk.name === "IDAT") {
      if (phase === "after" || header.color === 3 && !seenPalette) throw invalid("idat-order");
      phase = "data";
    } else if (phase === "data") phase = "after";
    if (chunk.name === "PLTE") {
      if (phase !== "before" || seenPalette || seenTransparency || [0, 4].includes(header.color) || chunk.length < 3 || chunk.length > 768 || chunk.length % 3 !== 0 || header.color === 3 && chunk.length / 3 > 2 ** header.depth) throw invalid("palette");
      seenPalette = true; paletteEntries = chunk.length / 3;
    } else if (chunk.name === "tRNS") {
      if (phase !== "before" || seenTransparency || header.color === 3 && (!seenPalette || chunk.length < 1 || chunk.length > paletteEntries) || header.color === 0 && chunk.length !== 2 || header.color === 2 && chunk.length !== 6 || [4, 6].includes(header.color)) throw invalid("transparency");
      seenTransparency = true;
    } else if (chunk.name === "IEND") {
      if (phase === "before" || chunk.length !== 0) throw invalid("iend");
    } else if (chunk.name !== "IDAT" && /^[A-Z]/.test(chunk.name)) throw invalid("unsupported-critical-chunk");
    let remaining: number = chunk.length;
    while (remaining > 0) {
      const bytes: Uint8Array = await cursor.read(Math.min(remaining, 1024));
      crc = pngCrc(bytes, crc); remaining -= bytes.byteLength;
      if (chunk.name === "IDAT") { inputBytes += bytes.byteLength; yield bytes; }
    }
    await checkCrc(cursor, crc);
    if (chunk.name === "IEND") { await cursor.end(); return; }
  }
  throw invalid("chunk-count-limit");
  }
  return { chunks: chunks(), paletteSize: (): number => paletteEntries, compressedBytes: (): number => inputBytes };
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate: number = left + above - upperLeft;
  const a: number = Math.abs(estimate - left);
  const b: number = Math.abs(estimate - above);
  const c: number = Math.abs(estimate - upperLeft);
  return a <= b && a <= c ? left : b <= c ? above : upperLeft;
}

/** 원본 행을 바꾸지 않고 PNG 필터 0~4를 실제 픽셀 샘플 바이트로 복원합니다. */
export function decodePngRow(encoded: Uint8Array, previous: Uint8Array, filter: number, pixelBytes: number): Uint8Array {
  if (filter < 0 || filter > 4 || !Number.isInteger(filter) || previous.byteLength !== encoded.byteLength) throw invalid("filter");
  const decoded: Uint8Array = new Uint8Array(encoded.byteLength);
  for (let index: number = 0; index < encoded.byteLength; index += 1) {
    const left: number = index < pixelBytes ? 0 : decoded[index - pixelBytes];
    const above: number = previous[index];
    const upperLeft: number = index < pixelBytes ? 0 : previous[index - pixelBytes];
    const predictor: number = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, upperLeft);
    decoded[index] = (encoded[index] + predictor) & 255;
  }
  return decoded;
}

function checkPalette(row: Uint8Array, width: number, depth: number, paletteEntries: number): void {
  const mask: number = 2 ** depth - 1;
  for (let pixel: number = 0; pixel < width; pixel += 1) {
    const bit: number = pixel * depth;
    const index: number = (row[Math.floor(bit / 8)] >>> (8 - depth - bit % 8)) & mask;
    if (index >= paletteEntries) throw invalid("palette-index");
  }
}

async function decodePixels(input: AsyncIterable<Uint8Array>, header: PngHeader, paletteSize: () => number): Promise<PngPixelProof> {
  const passes: readonly ImagePass[] = imagePasses(header);
  let passIndex: number = 0;
  let rowIndex: number = 0;
  let offset: number = -1;
  let filter: number = 0;
  let encoded: Uint8Array = new Uint8Array(passes[0].rowBytes);
  let previous: Uint8Array = new Uint8Array(encoded.byteLength);
  let scanlines: number = 0;
  let decodedBytes: number = 0;
  let maximumInflateChunkBytes: number = 0;
  const digest: Hash = createHash("sha256");
  for await (const chunk of input) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > 65536) throw invalid("inflate-chunk-limit");
    maximumInflateChunkBytes = Math.max(maximumInflateChunkBytes, chunk.byteLength);
    let chunkOffset: number = 0;
    while (chunkOffset < chunk.byteLength) {
      if (passIndex >= passes.length) throw invalid("excess-pixel-data");
      if (offset === -1) { filter = chunk[chunkOffset++]; offset = 0; if (filter > 4) throw invalid("filter"); }
      const length: number = Math.min(encoded.byteLength - offset, chunk.byteLength - chunkOffset);
      encoded.set(chunk.subarray(chunkOffset, chunkOffset + length), offset);
      offset += length; chunkOffset += length;
      if (offset === encoded.byteLength) {
        const decoded: Uint8Array = decodePngRow(encoded, previous, filter, Math.max(1, Math.ceil(header.depth * header.channels / 8)));
        if (header.color === 3) checkPalette(decoded, passes[passIndex].width, header.depth, paletteSize());
        digest.update(decoded); decodedBytes += decoded.byteLength; scanlines += 1;
        previous = decoded; offset = -1; rowIndex += 1;
        if (rowIndex === passes[passIndex].height) {
          passIndex += 1; rowIndex = 0;
          if (passIndex < passes.length) { encoded = new Uint8Array(passes[passIndex].rowBytes); previous = new Uint8Array(encoded.byteLength); }
        }
      }
    }
  }
  if (passIndex !== passes.length || offset !== -1) throw invalid("truncated-pixel-data");
  return { width: header.width, height: header.height, pixels: header.width * header.height, scanlines, decodedBytes, maximumRowBytes: Math.max(...passes.map((pass: ImagePass): number => pass.rowBytes)), maximumInflateChunkBytes, scanlineSha256: digest.digest("hex") };
}

async function parsePng(source: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<PngPixelProof> {
  const cursor: ByteCursor = byteCursor(source);
  try {
    const header: PngHeader = await readHeader(cursor);
    const data: PngData = imageData(cursor, header);
    const compressed: Readable = Readable.from(data.chunks, { objectMode: false, highWaterMark: 1024 });
    const inflater: Inflate = createInflate({ chunkSize: 16384, windowBits: 15 });
    const outcomes = await Promise.allSettled([
      pipeline(compressed, inflater, { signal }),
      decodePixels(inflater, header, data.paletteSize).catch((error: unknown): never => { inflater.destroy(error instanceof Error ? error : new Error("PNG 픽셀 검증이 실패했습니다.", { cause: error })); throw error; }),
    ]);
    const [piping, pixels] = outcomes;
    if (pixels.status === "rejected") throw pixels.reason;
    if (!signal.aborted && inflater.bytesWritten !== data.compressedBytes()) throw Object.assign(invalid("trailing-compressed-bytes"), { cause: piping.status === "rejected" ? piping.reason : undefined });
    if (piping.status === "rejected") throw piping.reason;
    return pixels.value;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && ["Z_DATA_ERROR", "Z_BUF_ERROR", "ERR_STREAM_PREMATURE_CLOSE"].includes(String(error.code))) throw Object.assign(invalid("deflate"), { cause: error });
    throw error;
  } finally { await cursor.close(); }
}

/** 파일 전체와 전체 픽셀 이미지를 보관하지 않고 압축·CRC·행·인터레이스·해시를 검증합니다. */
export async function validatePngContent(source: ReadableStream<Uint8Array>, metadata: MaterialMetadata, signal: AbortSignal): Promise<PngContentProof> {
  if (metadata.kind !== "image" || metadata.mime !== "image/png") throw materialFailure("material_type_mismatch", "png-validator-kind", 415);
  const stop: AbortController = new AbortController();
  const combined: AbortSignal = AbortSignal.any([signal, stop.signal]);
  const bridge: TransformStream<Uint8Array, Uint8Array> = new TransformStream();
  const outcomes = await Promise.allSettled([
    transferMaterialBytes(source, bridge.writable, metadata, combined),
    parsePng(bridge.readable, combined).catch((error: unknown): never => { stop.abort(error); throw error; }),
  ]);
  const [transfer, image] = outcomes;
  if (image.status === "rejected") throw image.reason;
  if (transfer.status === "rejected") throw transfer.reason;
  return { kind: "image", mime: "image/png", pages: 1, transfer: transfer.value, image: image.value };
}
