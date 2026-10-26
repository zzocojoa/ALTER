import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { transferMaterialBytes } from "../../lib/materials/stream";
import { materialPolicy } from "../../lib/materials/policy";
import type { MaterialMetadata } from "../../lib/materials/policy";

function metadata(bytes: number, sha256: string): MaterialMetadata {
  return { title: "스트림 검사", edition: "", role: "reference", kind: "text", filename: "fixture.txt", mime: "text/plain", bytes, sha256 };
}
function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function source(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ type: "bytes", start(controller: ReadableByteStreamController): void { controller.enqueue(bytes.slice()); controller.close(); } });
}
function sink(): WritableStream<Uint8Array> { return new WritableStream<Uint8Array>({ write(): void {} }); }

const payload: Uint8Array = new TextEncoder().encode("안전한 자료 원본");
const expected: MaterialMetadata = metadata(payload.byteLength, digest(payload));

describe("자료 스트림 실측", (): void => {
  it("SHA-256과 실제 바이트를 반환하고 입력 메타데이터·바이트를 바꾸지 않는다", async (): Promise<void> => {
    const copied: number[] = [];
    const destination: WritableStream<Uint8Array> = new WritableStream({ write(chunk: Uint8Array): void { copied.push(...chunk); } });
    const result = await transferMaterialBytes(source(payload), destination, expected, new AbortController().signal);
    expect(result).toMatchObject({ bytes: payload.byteLength, sha256: digest(payload) });
    expect(copied).toEqual([...payload]); expect(expected.bytes).toBe(payload.byteLength);
  });
  it("입력이 한 번에 큰 청크를 주어도 읽기 버퍼를 64KiB로 제한한다", async (): Promise<void> => {
    const bytes: Uint8Array = new Uint8Array(materialPolicy.types.text.maximumBytes).fill(97);
    const result = await transferMaterialBytes(source(bytes), sink(), metadata(bytes.byteLength, digest(bytes)), new AbortController().signal);
    expect(result.maximumReadBytes).toBe(materialPolicy.streamChunkBytes);
    expect(result.maximumReadBufferBytes).toBe(materialPolicy.streamChunkBytes);
  });
  it("정확한 길이보다 한 바이트 적거나 많으면 정상 종료를 허용하지 않는다", async (): Promise<void> => {
    for (const bytes of [payload.slice(1), new Uint8Array([...payload, 0])]) {
      let closed: boolean = false;
      const destination: WritableStream<Uint8Array> = new WritableStream({ close(): void { closed = true; } });
      await expect(transferMaterialBytes(source(bytes), destination, expected, new AbortController().signal)).rejects.toMatchObject({ code: "material_body_length_invalid" });
      expect(closed).toBe(false);
    }
  });
  it("체크섬이 다르면 정상 종료를 허용하지 않는다", async (): Promise<void> => {
    await expect(transferMaterialBytes(source(payload), sink(), { ...expected, sha256: "0".repeat(64) }, new AbortController().signal)).rejects.toMatchObject({ code: "material_checksum_mismatch" });
  });
  it("이미 취소한 요청은 원본을 읽지 않는다", async (): Promise<void> => {
    const controller: AbortController = new AbortController(); controller.abort(new DOMException("검사 취소", "AbortError"));
    let reads: number = 0;
    const input: ReadableStream<Uint8Array> = new ReadableStream({ type: "bytes", pull(): void { reads += 1; } });
    await expect(transferMaterialBytes(input, sink(), expected, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(reads).toBe(0); expect(input.locked).toBe(false);
  });
  it("입력이 대기 중이어도 취소하면 종료하고 잠금을 해제한다", async (): Promise<void> => {
    const controller: AbortController = new AbortController();
    let cancelled: boolean = false;
    const input: ReadableStream<Uint8Array> = new ReadableStream({ type: "bytes", pull(): void { controller.abort(new DOMException("전송 중단", "AbortError")); }, cancel(): void { cancelled = true; } });
    await expect(transferMaterialBytes(input, sink(), expected, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true); expect(input.locked).toBe(false);
  });
  it("목적지 실패 원인을 유지하고 입력을 취소한다", async (): Promise<void> => {
    const failure: Error = new Error("저장소 쓰기 실패");
    let cancelled: boolean = false; let sent: boolean = false;
    const input: ReadableStream<Uint8Array> = new ReadableStream({ type: "bytes", pull(controller: ReadableByteStreamController): void { if (!sent) { sent = true; controller.enqueue(payload.slice()); } }, cancel(): void { cancelled = true; } });
    const destination: WritableStream<Uint8Array> = new WritableStream({ write(): void { throw failure; } });
    const partialExpected: MaterialMetadata = metadata(payload.byteLength * 2, digest(new Uint8Array([...payload, ...payload])));
    await expect(transferMaterialBytes(input, destination, partialExpected, new AbortController().signal)).rejects.toBe(failure);
    expect(cancelled).toBe(true); expect(input.locked).toBe(false);
  });
  it("입력 실패 원인을 유지하고 목적지를 중단한다", async (): Promise<void> => {
    const failure: Error = new Error("원본 연결 중단");
    const input: ReadableStream<Uint8Array> = new ReadableStream({ type: "bytes", pull(): void { throw failure; } });
    let abortReason: unknown;
    const destination: WritableStream<Uint8Array> = new WritableStream({ abort(reason: unknown): void { abortReason = reason; } });
    await expect(transferMaterialBytes(input, destination, expected, new AbortController().signal)).rejects.toBe(failure);
    expect(abortReason).toBe(failure); expect(input.locked).toBe(false);
  });
  it("바이트 읽기를 지원하지 않으면 전체 버퍼 방식으로 대체하지 않는다", async (): Promise<void> => {
    let abortReason: unknown;
    const destination: WritableStream<Uint8Array> = new WritableStream({ abort(reason: unknown): void { abortReason = reason; } });
    await expect(transferMaterialBytes(new ReadableStream<Uint8Array>(), destination, expected, new AbortController().signal)).rejects.toMatchObject({ code: "material_stream_unsupported" });
    expect(abortReason).toMatchObject({ code: "material_stream_unsupported" });
  });
});
