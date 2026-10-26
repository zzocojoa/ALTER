import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pdfProbes, pdfProbeMetadata, requirePdfProbeResult } from "../../lib/materials/pdf-probe";
import { validatePdfStructure } from "../../lib/materials/pdf-content";
import type { MaterialFailure } from "../../lib/materials/policy";

const compiled: WebAssembly.Module = new WebAssembly.Module(readFileSync("lib/materials/pdf-wasm/validator.wasm"));
describe("운영 PDF 검사 계약", () => {
  it.each(pdfProbes)("$id 고정 PDF의 처리와 거부 사유를 대조한다", async (fixture) => {
    const bytes: Buffer = readFileSync(`public${fixture.url}`);
    const sha256: string = createHash("sha256").update(bytes).digest("hex");
    const metadata = pdfProbeMetadata(new Request("https://alter.test/pdf", { headers: { "x-pdf-probe": fixture.id, "content-type": "application/pdf", "content-length": String(bytes.length) } }));
    expect(metadata.sha256).toBe(sha256);
    const outcome = await Promise.allSettled([validatePdfStructure({ bytes: bytes.length, read: async (offset: number, length: number): Promise<Uint8Array> => bytes.subarray(offset, offset + length) }, new AbortController().signal, compiled)]);
    const result = outcome[0];
    if (fixture.status === 200) {
      if (result.status === "rejected") throw result.reason;
      const proof = { transfer: { bytes: bytes.length, sha256, maximumReadBufferBytes: 65536 }, pdf: result.value, cleanup: "passed", accountQuotaVerified: false };
      expect(() => requirePdfProbeResult(fixture, 200, proof)).not.toThrow();
    } else {
      if (result.status === "fulfilled") throw new Error("거부 예정 PDF가 허용됐습니다.");
      const failure: MaterialFailure = result.reason as MaterialFailure;
      expect(() => requirePdfProbeResult(fixture, failure.status, { error: failure.code, field: failure.field })).not.toThrow();
    }
  });
  it("200 응답의 증거 누락과 다른 거부 사유를 실패 처리한다", () => {
    expect(() => requirePdfProbeResult(pdfProbes[0], 200, {})).toThrow("응답 형식");
    expect(() => requirePdfProbeResult(pdfProbes[6], 422, { error: "material_content_invalid", field: "unrelated" })).toThrow("거부 사유");
  });
});
