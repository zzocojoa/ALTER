import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import createJpegModule from "../../lib/materials/jpeg-wasm/decoder.js";
import { validateJpegContent } from "../../lib/materials/jpeg-content";
import type { JpegContentProof } from "../../lib/materials/jpeg-content";
import type { MaterialMetadata } from "../../lib/materials/policy";
import { paddedJpeg } from "../fixtures/jpeg-bytes";
import { pngSource } from "../fixtures/png-bytes";
import manifest from "../fixtures/jpeg/manifest.json";

const compiled: WebAssembly.Module = new WebAssembly.Module(await readFile("lib/materials/jpeg-wasm/decoder.wasm"));
function metadata(bytes: Uint8Array): MaterialMetadata { return { title: "JPEG 검증", edition: "", role: "reference", kind: "image", filename: "fixture.jpg", mime: "image/jpeg", bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }; }
async function validate(bytes: Uint8Array, chunk: number): Promise<JpegContentProof> { return validateJpegContent(pngSource(bytes, chunk), metadata(bytes), new AbortController().signal, compiled); }

describe("JPEG 고정 창 전체 디코딩", () => {
  it("실제 WASM 모듈이 64MiB 초과 메모리 증가를 거부한다", async () => {
    let memory: WebAssembly.Memory | undefined;
    await createJpegModule({ instantiateWasm(imports, receive) {
      const instance: WebAssembly.Instance = new WebAssembly.Instance(compiled, imports);
      const exported: WebAssembly.ModuleExportDescriptor | undefined = WebAssembly.Module.exports(compiled).find((item) => item.kind === "memory");
      if (exported === undefined) throw new Error("WASM 메모리 export가 없습니다.");
      memory = instance.exports[exported.name] as WebAssembly.Memory;
      receive(instance, compiled); return instance.exports;
    } });
    if (memory === undefined) throw new Error("WASM 메모리를 확인할 수 없습니다.");
    const checked: WebAssembly.Memory = memory;
    expect(() => checked.grow((67108864 - checked.buffer.byteLength) / 65536 + 1)).toThrow(RangeError);
  });
  it.each(manifest.fixtures)("$name 실제 픽셀을 독립 네이티브 기준과 대조한다", async (fixture) => {
    const bytes: Buffer = await readFile(`tests/fixtures/jpeg/${fixture.name}.jpg`);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
    if (fixture.expectedStatus !== 200) { await expect(validate(bytes, 16384)).rejects.toMatchObject({ code: "material_content_invalid" }); return; }
    const result: JpegContentProof = await validate(bytes, 16384);
    expect(result.image).toMatchObject({ width: fixture.width, height: fixture.height, scanlines: fixture.height, scanlineSha256: fixture.scanlineSha256 });
    expect(result.image.maximumInputWindowBytes).toBeLessThanOrEqual(65536);
    expect(result.image.wasmMemoryBytes).toBeLessThanOrEqual(67108864);
    expect(result.transfer.sha256).toBe(fixture.sha256);
  });
  it.each([1, 2, 7, 1024, 65536])("%i 바이트 입력 경계에서 점진형 재시작 위치를 보존한다", async (chunk: number) => {
    const bytes: Buffer = await readFile("tests/fixtures/jpeg/progressive-420.jpg");
    expect((await validate(bytes, chunk)).image.scanlineSha256).toBe(manifest.fixtures.find((item) => item.name === "progressive-420")?.scanlineSha256);
  });
  it("손상·EOI 누락·빈 입력·뒤따르는 파일을 복구하지 않는다", async () => {
    const bytes: Buffer = await readFile("tests/fixtures/jpeg/rgb-420.jpg");
    const corrupted: Buffer = Buffer.from(bytes); corrupted[0] = 0;
    for (const sample of [new Uint8Array(), bytes.subarray(0, 1), bytes.subarray(0, bytes.length - 2), bytes.subarray(0, bytes.length - 50), corrupted, Buffer.concat([bytes, bytes])]) {
      await expect(validate(sample, 7)).rejects.toBeInstanceOf(Error);
    }
  });
  it("선언 크기가 상한 안이어도 실제 8MiB+1 바이트 전송을 거부한다", async () => {
    const gray: Buffer = await readFile("tests/fixtures/jpeg/gray.jpg");
    const bytes: Buffer = paddedJpeg(gray, 8388609);
    await expect(validateJpegContent(pngSource(bytes, 65536), { ...metadata(bytes), bytes: 8388608 }, new AbortController().signal, compiled)).rejects.toMatchObject({ code: "material_body_length_invalid" });
  });
  it("픽셀 수·점진형 계수 메모리 초과를 구분한다", async () => {
    for (const [name, field] of [["pixel-limit", "pixel-limit"], ["coefficient-limit", "coefficient-memory-limit"]]) await expect(validate(await readFile(`tests/fixtures/jpeg/${name}.jpg`), 65536)).rejects.toMatchObject({ field: `jpeg:${field}` });
  });
  it("클라이언트 체크섬 불일치와 취소를 성공 처리하지 않는다", async () => {
    const bytes: Buffer = await readFile("tests/fixtures/jpeg/gray.jpg");
    await expect(validateJpegContent(pngSource(bytes, 7), { ...metadata(bytes), sha256: "0".repeat(64) }, new AbortController().signal, compiled)).rejects.toMatchObject({ code: "material_checksum_mismatch" });
    await expect(validateJpegContent(pngSource(bytes, 7), metadata(bytes), AbortSignal.abort(), compiled)).rejects.toMatchObject({ name: "AbortError" });
  });
});
