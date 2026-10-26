import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { validatePdfStructure } from "../../lib/materials/pdf-content";
import type { PdfStructureProof } from "../../lib/materials/pdf-content";
import { pdfObjects, pdfStream } from "../fixtures/pdf-bytes";

const compiled: WebAssembly.Module = new WebAssembly.Module(await readFile("lib/materials/pdf-wasm/validator.wasm"));
function validate(bytes: Uint8Array): Promise<PdfStructureProof> { return validatePdfStructure({ bytes: bytes.length, read: async (offset: number, length: number): Promise<Uint8Array> => bytes.slice(offset, offset + length) }, new AbortController().signal, compiled); }
function imagePdf(image: Uint8Array, width: number, height: number, bits: number, color: string): Uint8Array {
  const content: Buffer = Buffer.from("q 100 0 0 100 0 0 cm /Im0 Do Q\n");
  return pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>", pdfStream("", content, content.length), pdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${color} /BitsPerComponent ${bits} /Filter /FlateDecode`, image, image.length), pdfStream("/N 3", new Uint8Array(), 0)]);
}

describe("PDF 16비트 Flate 영상 표본 검증", () => {
  it.each(["/DeviceRGB", "[/ICCBased 6 0 R]"])("%s 32MiB 영상 표본을 작은 WASM 메모리로 검사한다", async (color: string) => {
    const samples: number = 2048 * 2732 * 3 * 2;
    const proof: PdfStructureProof = await validate(imagePdf(deflateSync(Buffer.alloc(samples, 128)), 2048, 2732, 16, color));
    expect(proof.pages).toBe(1);
    expect(proof.processedStreamBytes).toBeGreaterThanOrEqual(samples);
    expect(proof.wasmMemoryBytes).toBeLessThanOrEqual(16777216);
    expect(proof.originalFileAccumulated).toBe(false);
    expect(proof.encodedImagePixelsDecoded).toBe(false);
  });
  it.each([5, 7])("표본의 실제 길이 %i가 선언된 6바이트와 다르면 거부한다", async (length: number) => {
    await expect(validate(imagePdf(deflateSync(Buffer.alloc(length)), 1, 1, 16, "/DeviceRGB"))).rejects.toMatchObject({ code: "material_content_invalid" });
  });
  it("1비트 행의 끝 패딩을 포함한 정확한 표본 길이를 검사한다", async () => {
    expect((await validate(imagePdf(deflateSync(Buffer.alloc(4)), 9, 2, 1, "/DeviceGray"))).pages).toBe(1);
    await expect(validate(imagePdf(deflateSync(Buffer.alloc(3)), 9, 2, 1, "/DeviceGray"))).rejects.toMatchObject({ field: "pdf:embedded-image-sample-length" });
  });
  it("영상의 체크섬·잘림·후행 바이트 오류를 계속 거부한다", async () => {
    const compressed: Buffer = deflateSync(Buffer.alloc(6));
    const corrupt: Buffer = Buffer.concat([compressed.subarray(0, -1), Buffer.from([compressed[compressed.length - 1] ^ 1])]);
    for (const image of [compressed.subarray(0, -1), corrupt, Buffer.concat([compressed, Buffer.from([0])])]) await expect(validate(imagePdf(image, 1, 1, 16, "/DeviceRGB"))).rejects.toMatchObject({ code: "material_content_invalid" });
  });
  it("여러 영상의 누적 표본이 1GiB를 넘으면 처리를 중단한다", async () => {
    const samples: Buffer = deflateSync(Buffer.alloc(4000 * 4000 * 4 * 2));
    const images: readonly Uint8Array[] = Array.from({ length: 9 }, (): Uint8Array => pdfStream("/Type /XObject /Subtype /Image /Width 4000 /Height 4000 /ColorSpace /DeviceCMYK /BitsPerComponent 16 /Filter /FlateDecode", samples, samples.length));
    const bytes: Uint8Array = pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>", ...images]);
    await expect(validate(bytes)).rejects.toMatchObject({ field: "pdf:image-sample-budget" });
  });
  it("허용 픽셀 수와 비트 깊이를 벗어난 선언을 거부한다", async () => {
    const compressed: Buffer = deflateSync(Buffer.alloc(1));
    for (const [width, height, bits] of [[0, 1, 8], [16000001, 1, 8], [1, 1, 12]]) await expect(validate(imagePdf(compressed, width, height, bits, "/DeviceRGB"))).rejects.toMatchObject({ code: "material_content_invalid" });
  });
});
