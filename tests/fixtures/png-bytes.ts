import { crc32, deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { MaterialMetadata } from "../../lib/materials/policy";

export type PngFixtureHeader = Readonly<{ width: number; height: number; depth: number; color: number; interlace: number }>;
export function pngChunk(name: string, data: Uint8Array): Buffer {
  const type: Buffer = Buffer.from(name, "ascii");
  const size: Buffer = Buffer.alloc(4); size.writeUInt32BE(data.byteLength);
  const checksum: Buffer = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, checksum]);
}
export function pngHeader(value: PngFixtureHeader): Buffer {
  const bytes: Buffer = Buffer.alloc(13);
  bytes.writeUInt32BE(value.width, 0); bytes.writeUInt32BE(value.height, 4);
  bytes[8] = value.depth; bytes[9] = value.color; bytes[12] = value.interlace;
  return pngChunk("IHDR", bytes);
}
export function pngFile(chunks: readonly Uint8Array[]): Buffer { return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), ...chunks]); }
export function pngImage(header: PngFixtureHeader, rows: Uint8Array): Buffer { return pngFile([pngHeader(header), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", new Uint8Array(0))]); }
export function pngMetadata(bytes: Uint8Array): MaterialMetadata {
  return { title: "PNG 검증 원본", edition: "", role: "reference", kind: "image", filename: "fixture.png", mime: "image/png", bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}
export function pngSource(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset: number = 0;
  return new ReadableStream({ type: "bytes", pull(controller: ReadableByteStreamController): void {
    if (offset === bytes.byteLength) { controller.close(); controller.byobRequest?.respond(0); return; }
    const end: number = Math.min(offset + chunkSize, bytes.byteLength);
    controller.enqueue(new Uint8Array(bytes.subarray(offset, end))); offset = end;
  } });
}
