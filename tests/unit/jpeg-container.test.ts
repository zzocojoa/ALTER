import { describe, expect, it } from "vitest";
import { indexedJpeg } from "../fixtures/jpeg-mpf";
import { readJpegContainer } from "../../lib/materials/jpeg-container";
import { parseJpegMpf } from "../../lib/materials/jpeg-mpf";

const minimal: Uint8Array = Uint8Array.from([255, 216, 255, 218, 0, 2, 1, 255, 0, 2, 255, 208, 3, 255, 217]);
function chunks(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset: number = 0;
  return new ReadableStream({ pull(controller): void { if (offset === bytes.length) { controller.close(); return; } controller.enqueue(bytes.subarray(offset, offset + size)); offset = Math.min(offset + size, bytes.length); } });
}
async function drain(body: ReadableStream<Uint8Array>): Promise<Uint8Array> { return new Uint8Array(await new Response(body).arrayBuffer()); }
describe("JPEG 컨테이너의 경계·MPF 색인", (): void => {
  it.each([1, 2, 7, 64, 65536])("%i 바이트 조각에서도 두 원본 경계와 색인을 보존한다", async (size): Promise<void> => {
    const bytes: Uint8Array = indexedJpeg(minimal, minimal, "big");
    const stream = readJpegContainer(chunks(bytes, size), new AbortController().signal);
    try {
      const first = stream.frame(); expect(await drain(first.body)).toEqual(bytes.subarray(0, minimal.length + 90));
      expect(first.facts()).toMatchObject({ start: 0, end: minimal.length + 90, mpf: { primaryBytes: minimal.length + 90, auxiliaryOffset: minimal.length + 90, auxiliaryBytes: minimal.length } });
      const second = stream.frame(); expect(await drain(second.body)).toEqual(minimal); expect(second.facts().mpf).toBeNull(); await stream.requireEnd();
    } finally { await stream.close(); }
  });
  it("색인이 없는 이어 붙인 JPEG를 여전히 거부한다", async (): Promise<void> => {
    const stream = readJpegContainer(chunks(Uint8Array.from([...minimal, ...minimal]), 65536), new AbortController().signal);
    try { await drain(stream.frame().body); await expect(stream.requireEnd()).rejects.toMatchObject({ field: "jpeg:trailing-bytes" }); } finally { await stream.close(); }
  });
  it.each([0, 4, 15, 45, 70])("잘린 MPF %i 바이트를 거부한다", (length): void => {
    const segment: Uint8Array = indexedJpeg(minimal, minimal, "big").subarray(6, 92);
    expect(() => parseJpegMpf(segment.subarray(0, Math.max(4, length)), 10)).toThrow();
  });
  it("과도한 입력 조각을 거부한다", async (): Promise<void> => {
    const stream = readJpegContainer(chunks(new Uint8Array(65537), 65537), new AbortController().signal);
    try { await expect(drain(stream.frame().body)).rejects.toMatchObject({ field: "jpeg:input-chunk-limit" }); } finally { await stream.close(); }
  });
});
