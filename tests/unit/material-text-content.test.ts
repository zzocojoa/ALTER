import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateTextContent } from "../../lib/materials/text-content";
import type { MaterialMetadata } from "../../lib/materials/policy";

function metadata(bytes: Uint8Array): MaterialMetadata {
  return { title: "텍스트", edition: "", role: "reference", kind: "text", filename: "notes.txt", mime: "text/plain", bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function source(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset: number = 0;
  return new ReadableStream({ type: "bytes", pull(controller: ReadableByteStreamController): void {
    if (offset === bytes.byteLength) { controller.close(); controller.byobRequest?.respond(0); return; }
    const end: number = Math.min(offset + chunkSize, bytes.byteLength);
    controller.enqueue(bytes.slice(offset, end)); offset = end;
  } });
}
const encoder: TextEncoder = new TextEncoder();
describe("누적 버퍼 없는 UTF-8 내용 검증", () => {
  it.each(["한글과 emoji 😀\r\n다음 줄\t탭", "\ufeffUTF-8 BOM", "<script>alert('원문')</script>"])("한 바이트 청크에서도 올바른 원문을 허용한다", async (text: string) => {
    const bytes: Uint8Array = encoder.encode(text);
    const result = await validateTextContent(source(bytes, 1), metadata(bytes), new AbortController().signal);
    expect(result.encoding).toBe("utf-8"); expect(result.transfer.bytes).toBe(bytes.length); expect(result.transfer.sha256).toBe(metadata(bytes).sha256);
  });
  it.each([[0xc3, 0x28], [0xf0, 0x9f], [0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xff, 0xfe, 0x61, 0x00], [0x61, 0x00, 0x62]])("손상·잘린 문자·UTF-16·바이너리 제어 문자를 거부한다", async (...values: number[]) => {
    const bytes: Uint8Array = new Uint8Array(values);
    await expect(validateTextContent(source(bytes, 1), metadata(bytes), new AbortController().signal)).rejects.toMatchObject({ code: "material_content_invalid", status: 422 });
  });
  it("최대 텍스트에서도 읽기 버퍼가 64KiB를 넘지 않는다", async () => {
    const bytes: Uint8Array = new Uint8Array(1048576).fill(97);
    const result = await validateTextContent(source(bytes, bytes.length), metadata(bytes), new AbortController().signal);
    expect(result.transfer.maximumReadBufferBytes).toBeLessThanOrEqual(65536);
  });
  it("유효한 텍스트라도 해시 불일치와 취소를 거부한다", async () => {
    const bytes: Uint8Array = encoder.encode("학습 기록");
    await expect(validateTextContent(source(bytes, 2), { ...metadata(bytes), sha256: "0".repeat(64) }, new AbortController().signal)).rejects.toMatchObject({ code: "material_checksum_mismatch" });
    const abort: AbortController = new AbortController(); abort.abort();
    await expect(validateTextContent(source(bytes, 2), metadata(bytes), abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
