import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openMaterialBody, requireMaterialSignature } from "../../lib/materials/signature";
import type { MaterialMetadata } from "../../lib/materials/policy";

const metadata: MaterialMetadata = { title: "원본", edition: "", kind: "text", role: "reference", filename: "원본.txt", mime: "text/plain", bytes: 12, sha256: "a".repeat(64) };
function stream(data: Uint8Array): ReadableStream<Uint8Array> { let offset: number = 0; return new ReadableStream({ type: "bytes", pull(controller: ReadableByteStreamController): void { if (offset === data.length) { controller.close(); controller.byobRequest?.respond(0); return; } const end: number = Math.min(offset + 2, data.length); controller.enqueue(data.slice(offset, end)); offset = end; } }); }
describe("원본 전송 전 최소 시그니처", (): void => {
  it("유형별 정상 시그니처와 위장 입력을 구분한다", (): void => {
    const inputs: readonly Readonly<{ metadata: MaterialMetadata; bytes: Uint8Array }>[] = [
      { metadata: { ...metadata, kind: "pdf", mime: "application/pdf", filename: "원본.pdf" }, bytes: new TextEncoder().encode("%PDF-1.7") },
      { metadata: { ...metadata, kind: "image", mime: "image/png", filename: "원본.png" }, bytes: new Uint8Array([137,80,78,71,13,10,26,10]) },
      { metadata: { ...metadata, kind: "image", mime: "image/jpeg", filename: "원본.jpg" }, bytes: new Uint8Array([255,216,255,224]) },
    ];
    for (const input of inputs) { requireMaterialSignature(input.bytes, input.metadata); expect(() => requireMaterialSignature(new Uint8Array(8), input.metadata)).toThrow(); }
  });
  it("짧은 정상 텍스트·분할 UTF-8은 허용하고 바이너리 제어 문자는 거부한다", (): void => {
    requireMaterialSignature(new TextEncoder().encode("가나").slice(0, 4), metadata);
    requireMaterialSignature(new TextEncoder().encode("a"), { ...metadata, bytes: 1 });
    expect(() => requireMaterialSignature(new Uint8Array([0]), metadata)).toThrow();
    expect(() => requireMaterialSignature(new Uint8Array([234,176]), { ...metadata, bytes: 2 })).toThrow();
  });
  it("선행 바이트를 잃거나 중복하지 않고 원본 전체를 스트리밍한다", async (): Promise<void> => {
    const data: Uint8Array = new TextEncoder().encode("가나다라마바사abcdefghijklmnop");
    const prepared = await openMaterialBody(stream(data), { ...metadata, bytes: data.length }, new AbortController().signal);
    const actual: Uint8Array = new Uint8Array(await new Response(prepared).arrayBuffer());
    expect(createHash("sha256").update(actual).digest("hex")).toBe(createHash("sha256").update(data).digest("hex"));
  });
  it("선행 본문 부족과 시작 전 취소를 명시적으로 거부한다", async (): Promise<void> => {
    await expect(openMaterialBody(stream(new Uint8Array([97])), metadata, new AbortController().signal)).rejects.toMatchObject({ code: "material_body_length_invalid" });
    const stop: AbortController = new AbortController(); stop.abort(new Error("cancelled"));
    await expect(openMaterialBody(stream(new Uint8Array(10)), metadata, stop.signal)).rejects.toThrow("cancelled");
  });
});
