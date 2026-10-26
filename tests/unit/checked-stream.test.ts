import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCheckedByteStream } from "../../lib/materials/checked-stream";
import type { CheckedStreamProof } from "../../lib/materials/checked-stream";

function sourceOf(bytes: number): ReadableStream<Uint8Array> {
  let sent: number = 0;
  return new ReadableStream({ type: "bytes", pull(controller: ReadableByteStreamController): void { if (sent === bytes) { controller.close(); controller.byobRequest?.respond(0); return; } const count: number = Math.min(65536, bytes - sent); sent += count; controller.enqueue(new Uint8Array(count).fill(97)); } });
}
function hashOf(bytes: number): string { return createHash("sha256").update(new Uint8Array(bytes).fill(97)).digest("hex"); }
async function drain(stream: ReadableStream<Uint8Array>): Promise<void> { await stream.pipeTo(new WritableStream<Uint8Array>({ write(): void {} })); }
describe("원본·백업 공통 검증 스트림", () => {
  it("소비 전에는 읽지 않고 64KiB 버퍼와 마지막 검증 뒤에만 EOF를 보낸다", async () => {
    const proofs: CheckedStreamProof[] = [];
    const stream = createCheckedByteStream(sourceOf(180000), { bytes: 180000, sha256: hashOf(180000) }, new AbortController().signal, async proof => { proofs.push(proof); });
    expect(proofs).toHaveLength(0); await drain(stream);
    expect(proofs).toEqual([{ bytes: 180000, sha256: hashOf(180000), maximumReadBytes: 65536, maximumReadBufferBytes: 65536 }]);
  });
  it("짧은·긴 본문과 잘못된 해시에서는 검증 콜백을 실행하지 않는다", async () => {
    for (const scenario of [{ actual: 9, expected: 10, hash: hashOf(10), code: "material_body_length_invalid" }, { actual: 11, expected: 10, hash: hashOf(10), code: "material_body_length_invalid" }, { actual: 10, expected: 10, hash: "0".repeat(64), code: "material_checksum_mismatch" }]) {
      const proofs: CheckedStreamProof[] = [];
      await expect(drain(createCheckedByteStream(sourceOf(scenario.actual), { bytes: scenario.expected, sha256: scenario.hash }, new AbortController().signal, async proof => { proofs.push(proof); }))).rejects.toMatchObject({ code: scenario.code });
      expect(proofs).toHaveLength(0);
    }
  });
  it("마지막 원본 버전 대조 실패를 정상 EOF로 바꾸지 않는다", async () => {
    let delivered: number = 0;
    const stream = createCheckedByteStream(sourceOf(180000), { bytes: 180000, sha256: hashOf(180000) }, new AbortController().signal, async () => { throw new Error("원본 버전 변경"); });
    await expect(stream.pipeTo(new WritableStream<Uint8Array>({ write(chunk: Uint8Array): void { delivered += chunk.byteLength; } }))).rejects.toThrow("원본 버전 변경");
    expect(delivered).toBe(131072);
  });
  it("클라이언트 취소와 진행 중 abort에서 수신 완료를 발급하지 않는다", async () => {
    const proofs: CheckedStreamProof[] = [];
    const controller: AbortController = new AbortController();
    const stream = createCheckedByteStream(sourceOf(180000), { bytes: 180000, sha256: hashOf(180000) }, controller.signal, async proof => { proofs.push(proof); });
    const reader = stream.getReader(); await reader.read(); await reader.cancel("수신 취소"); expect(proofs).toHaveLength(0);
    const abort: AbortController = new AbortController();
    const aborted = createCheckedByteStream(sourceOf(180000), { bytes: 180000, sha256: hashOf(180000) }, abort.signal, async proof => { proofs.push(proof); });
    const pending = aborted.getReader(); await pending.read(); abort.abort(new Error("연결 끊김")); await expect(pending.read()).rejects.toThrow("연결 끊김"); expect(proofs).toHaveLength(0);
  });
});
