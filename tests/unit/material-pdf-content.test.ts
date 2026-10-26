import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import createPdfModule from "../../lib/materials/pdf-wasm/validator.js";
import { validatePdfStructure } from "../../lib/materials/pdf-content";
import type { PdfStructureProof } from "../../lib/materials/pdf-content";
import { contentPdf, pageTreePdf, pdfObjects, pdfStream, scannedPdf, textPdf } from "../fixtures/pdf-bytes";
import manifest from "../fixtures/pdf/manifest.json";

const compiled: WebAssembly.Module = new WebAssembly.Module(await readFile("lib/materials/pdf-wasm/validator.wasm"));
function validate(bytes: Uint8Array): Promise<PdfStructureProof> { return validatePdfStructure({ bytes: bytes.length, read: async (offset: number, length: number): Promise<Uint8Array> => bytes.slice(offset, offset + length) }, new AbortController().signal, compiled); }

describe("PDF 고정 Range 구조 검증", () => {
  it("텍스트 PDF의 실제 페이지와 일반 압축 스트림을 검증한다", async () => {
    expect(await validate(textPdf())).toMatchObject({ pages: 1, streams: 1, encodedImageStreams: 0, originalFileAccumulated: false, encodedImagePixelsDecoded: false });
  });
  it.each(manifest.fixtures)("공식 $name PDF 구조를 읽는다", async (fixture) => {
    const proof: PdfStructureProof = await validate(await readFile(`tests/fixtures/pdf/${fixture.name}.pdf`));
    expect(proof.pages).toBe(fixture.pages);
    expect(proof.maximumRangeBytes).toBeLessThanOrEqual(65536);
    expect(proof.wasmMemoryBytes).toBeLessThanOrEqual(67108864);
  });
  it("JPEG 스캔 PDF는 이미지 구조와 길이를 검증하며 픽셀 해석을 주장하지 않는다", async () => {
    const jpeg: Buffer = await readFile("tests/fixtures/jpeg/gray.jpg");
    expect(await validate(scannedPdf(jpeg, "/DCTDecode", 17, 19))).toMatchObject({ pages: 1, streams: 2, encodedImageStreams: 1, encodedImagePixelsDecoded: false });
  });
  it("배열 형식 JPEG 필터와 Flate 스캔 PDF를 지원한다", async () => {
    const jpeg: Buffer = await readFile("tests/fixtures/jpeg/gray.jpg");
    expect((await validate(scannedPdf(jpeg, "[/DCTDecode]", 17, 19))).encodedImageStreams).toBe(1);
    expect((await validate(scannedPdf(deflateSync(new Uint8Array([128])), "/FlateDecode", 1, 1))).pages).toBe(1);
  });
  it.each([1, 500])("실제 %i 페이지 경계를 허용한다", async (pages: number) => { expect((await validate(pageTreePdf(pages, pages))).pages).toBe(pages); });
  it.each([0, 1, 3, -1, 501])("실제 2페이지의 위조 Count %i를 거부한다", async (count: number) => { await expect(validate(pageTreePdf(2, count))).rejects.toMatchObject({ code: "material_content_invalid" }); });
  it("501페이지를 거부한다", async () => { await expect(validate(pageTreePdf(501, 501))).rejects.toThrow(); });
  it("Pages 순환과 중복 Page를 거부한다", async () => {
    for (const kids of ["2 0 R", "3 0 R 3 0 R"]) await expect(validate(pdfObjects(["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count 2 >>`, "<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 10 10] >>"]))).rejects.toThrow();
  });
  it("startxref 오류·앞뒤 쓰레기·EOF 누락을 복구하지 않는다", async () => {
    const good: Uint8Array = textPdf();
    const wrongXref: Buffer = Buffer.from(Buffer.from(good).toString("latin1").replace(/startxref\n\d+/, "startxref\n0"), "latin1");
    for (const bytes of [wrongXref, Buffer.concat([Buffer.from("x"), good]), Buffer.concat([good, Buffer.from("garbage")]), good.subarray(0, good.length - 8)]) await expect(validate(bytes)).rejects.toThrow();
  });
  it("스트림 길이 불일치와 잘린 endstream을 거부한다", async () => {
    const bytes: Buffer = Buffer.from("q Q\n");
    for (const length of [bytes.length - 2, bytes.length + 2]) await expect(validate(contentPdf(pdfStream("", bytes, length)))).rejects.toThrow();
    await expect(validate(contentPdf(Buffer.from("<< /Length 4 >>\nstream\nq Q\nendstr")))).rejects.toThrow();
  });
  it("정상 빈 출력의 zlib 스트림을 허용한다", async () => {
    const bytes: Buffer = deflateSync(new Uint8Array());
    expect((await validate(contentPdf(pdfStream("/Filter /FlateDecode", bytes, bytes.length)))).pages).toBe(1);
  });
  it.each([0, 1, 2, 3, 5])("Flate %i 바이트 잘림을 거부한다", async (removed: number) => {
    const compressed: Buffer = deflateSync(Buffer.from("q Q\n"));
    const bytes: Uint8Array = removed === 0 ? new Uint8Array() : compressed.subarray(0, compressed.length - removed);
    await expect(validate(contentPdf(pdfStream("/Filter /FlateDecode", bytes, bytes.length)))).rejects.toThrow();
  });
  it("Adler 오류·후행 바이트·이어 붙인 zlib를 거부한다", async () => {
    const bytes: Buffer = deflateSync(Buffer.from("q Q\n"));
    const corrupted: Buffer = Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([bytes[bytes.length - 1] ^ 1])]);
    for (const sample of [corrupted, Buffer.concat([bytes, Buffer.from([0])]), Buffer.concat([bytes, bytes])]) await expect(validate(contentPdf(pdfStream("/Filter /FlateDecode", sample, sample.length)))).rejects.toThrow();
  });
  it("압축 해제량 상한을 넘는 폭탄을 거부한다", async () => {
    const compressed: Buffer = deflateSync(Buffer.alloc(16777217, 32));
    await expect(validate(contentPdf(pdfStream("/Filter /FlateDecode", compressed, compressed.length)))).rejects.toThrow();
  });
  it("미지원 일반 필터를 원본 검사로 바꾸지 않는다", async () => {
    const bytes: Buffer = Buffer.from("unsupported");
    await expect(validate(contentPdf(pdfStream("/Filter /NotAFilter", bytes, bytes.length)))).rejects.toMatchObject({ field: "pdf:unsupported-stream-filter" });
  });
  it("Range 짧은 응답·저장소 오류·취소를 성공 처리하지 않는다", async () => {
    const bytes: Uint8Array = textPdf();
    await expect(validatePdfStructure({ bytes: bytes.length, read: async (): Promise<Uint8Array> => new Uint8Array(1) }, new AbortController().signal, compiled)).rejects.toMatchObject({ field: "pdf:range-length-mismatch" });
    const failure: Error = new Error("fixture range unavailable");
    await expect(validatePdfStructure({ bytes: bytes.length, read: async (): Promise<Uint8Array> => { throw failure; } }, new AbortController().signal, compiled)).rejects.toBe(failure);
    await expect(validatePdfStructure({ bytes: bytes.length, read: async (): Promise<Uint8Array> => bytes }, AbortSignal.abort(), compiled)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("WASM 메모리를 64MiB 이상 확장할 수 없다", async () => {
    let memory: WebAssembly.Memory | undefined;
    await createPdfModule({ instantiateWasm(imports, receive) { const instance: WebAssembly.Instance = new WebAssembly.Instance(compiled, imports); const descriptor = WebAssembly.Module.exports(compiled).find((entry) => entry.kind === "memory"); if (descriptor === undefined) throw new Error("WASM 메모리 누락"); memory = instance.exports[descriptor.name] as WebAssembly.Memory; receive(instance, compiled); return instance.exports; }, readRange: async (): Promise<Uint8Array> => { throw new Error("예상하지 않은 Range 읽기"); }, rangeFailure(error: unknown): never { throw error; }, failure(message: string): never { throw new Error(message); }, complete(): never { throw new Error("예상하지 않은 검증 완료"); } });
    if (memory === undefined) throw new Error("WASM 메모리 미확인");
    const checked: WebAssembly.Memory = memory;
    expect(() => checked.grow((67108864 - checked.buffer.byteLength) / 65536 + 1)).toThrow(RangeError);
  });
});
