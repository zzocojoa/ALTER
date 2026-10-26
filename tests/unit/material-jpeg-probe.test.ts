import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jpegProbes, jpegProbeMetadata, requireJpegProbeResult } from "../../lib/materials/jpeg-probe";
import { validateJpegContent } from "../../lib/materials/jpeg-content";
import { pngMetadata, pngSource } from "../fixtures/png-bytes";
import type { MaterialFailure } from "../../lib/materials/policy";

const compiled: WebAssembly.Module = new WebAssembly.Module(readFileSync("lib/materials/jpeg-wasm/decoder.wasm"));

describe("운영 JPEG 검사 계약", () => {
  it.each(jpegProbes)("$id 고정 원본을 예상 처리 결과와 대조한다", async (fixture) => {
    const bytes: Buffer = readFileSync(new URL(`../../public${fixture.url}`, import.meta.url));
    const metadata = jpegProbeMetadata(new Request("https://alter.test/api/storage/jpeg-check", { headers: { "x-jpeg-probe": fixture.id, "content-type": "image/jpeg", "content-length": String(bytes.byteLength) } }));
    expect(metadata.sha256).toBe(pngMetadata(bytes).sha256);
    if (fixture.status === 200) {
      const result = await validateJpegContent(pngSource(bytes, 1024), metadata, new AbortController().signal, compiled);
      expect(() => requireJpegProbeResult(fixture, 200, result)).not.toThrow();
      return;
    }
    const outcome = await Promise.allSettled([validateJpegContent(pngSource(bytes, 1024), metadata, new AbortController().signal, compiled)]);
    expect(outcome[0].status).toBe("rejected");
    if (outcome[0].status !== "rejected") throw new Error("손상 검사 파일이 허용됐습니다.");
    const failure: MaterialFailure = outcome[0].reason as MaterialFailure;
    expect(() => requireJpegProbeResult(fixture, failure.status, { error: failure.code, field: failure.field })).not.toThrow();
  });
  it("HTTP 200이라도 누락된 내용 증거를 거부한다", () => {
    expect(() => requireJpegProbeResult(jpegProbes[0], 200, {})).toThrow("응답 형식");
  });
  it("손상 파일에서 예상하지 않은 실패를 통과시키지 않는다", () => {
    expect(() => requireJpegProbeResult(jpegProbes[4], 422, { error: "material_content_invalid", field: "wrong" })).toThrow("거부 사유");
    expect(() => requireJpegProbeResult(jpegProbes[4], 500, {})).toThrow("응답 상태");
  });
});
