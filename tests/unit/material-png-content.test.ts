import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePngRow, validatePngContent } from "../../lib/materials/png-content";
import { pngChunk, pngHeader, pngFile, pngImage, pngMetadata, pngSource } from "../fixtures/png-bytes";
import type { PngFixtureHeader } from "../fixtures/png-bytes";

const gray: PngFixtureHeader = { width: 4, height: 1, depth: 8, color: 0, interlace: 0 };
const good: Buffer = pngImage(gray, new Uint8Array([0, 10, 20, 30, 40]));
async function validate(bytes: Uint8Array): Promise<Awaited<ReturnType<typeof validatePngContent>>> {
  return validatePngContent(pngSource(bytes, 1), pngMetadata(bytes), new AbortController().signal);
}

describe("PNG 스트리밍 내용 검증", () => {
  it("원본과 실제 복원 픽셀 해시를 별도로 확인한다", async () => {
    const result = await validate(good);
    expect(result.transfer.sha256).toBe(pngMetadata(good).sha256);
    expect(result.image).toMatchObject({ width: 4, height: 1, decodedBytes: 4, scanlines: 1, maximumRowBytes: 4, scanlineSha256: createHash("sha256").update(new Uint8Array([10,20,30,40])).digest("hex") });
  });
  it.each([{ filter: 0, input: [10,20,30,40] }, { filter: 1, input: [10,10,10,10] }, { filter: 2, input: [7,13,21,38] }, { filter: 3, input: [9,12,16,24] }, { filter: 4, input: [7,10,10,10] }])("필터 $filter를 독립적인 알려진 픽셀로 복원한다", ({ filter, input }) => {
    const encoded: Uint8Array = new Uint8Array(input); const previous: Uint8Array = new Uint8Array([3,7,9,2]);
    expect([...decodePngRow(encoded, previous, filter, 1)]).toEqual([10,20,30,40]);
    expect([...encoded]).toEqual(input); expect([...previous]).toEqual([3,7,9,2]);
  });
  it.each([
    { name: "잘린 픽셀", rows: [0,1,2,3] }, { name: "초과 픽셀", rows: [0,1,2,3,4,5] }, { name: "잘못된 필터", rows: [5,1,2,3,4] },
  ])("$name 데이터를 거부한다", async ({ rows }) => {
    await expect(validate(pngImage(gray, new Uint8Array(rows)))).rejects.toMatchObject({ code: "material_content_invalid" });
  });
  it("올바른 chunk CRC라도 손상된 zlib 압축을 거부한다", async () => {
    const compressed: Buffer = deflateSync(new Uint8Array([0,1,2,3,4])); compressed[compressed.length - 1] ^= 255;
    await expect(validate(pngFile([pngHeader(gray), pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array())]))).rejects.toMatchObject({ code: "material_content_invalid" });
  });
  it("잘못된 CRC, 파일 끝 바이트와 잘린 파일을 거부한다", async () => {
    const badCrc: Buffer = Buffer.from(good); badCrc[29] ^= 1;
    for (const input of [badCrc, Buffer.concat([good, Buffer.from([0])]), good.subarray(0, good.length - 1)]) await expect(validate(input)).rejects.toMatchObject({ code: "material_content_invalid" });
  });
  it("픽셀 수와 한 행 메모리 한도 초과를 디코딩 전에 거부한다", async () => {
    for (const header of [{ ...gray, width: 4001, height: 4000 }, { ...gray, width: 100000, color: 6 }, { ...gray, width: 1, height: 65537 }]) await expect(validate(pngImage(header, new Uint8Array([0])))).rejects.toMatchObject({ code: "material_content_invalid" });
  });
  it("팔레트를 실제 인덱스와 대조한다", async () => {
    const header: PngFixtureHeader = { width: 2, height: 1, depth: 1, color: 3, interlace: 0 };
    const palette: Buffer = pngChunk("PLTE", new Uint8Array([255,0,0]));
    const valid: Buffer = pngFile([pngHeader(header), palette, pngChunk("IDAT", deflateSync(new Uint8Array([0,0]))), pngChunk("IEND", new Uint8Array())]);
    const invalid: Buffer = pngFile([pngHeader(header), palette, pngChunk("IDAT", deflateSync(new Uint8Array([0,128]))), pngChunk("IEND", new Uint8Array())]);
    expect((await validate(valid)).image.pixels).toBe(2);
    await expect(validate(invalid)).rejects.toMatchObject({ field: "png:palette-index" });
    await expect(validate(pngImage(header, new Uint8Array([0,0])))).rejects.toMatchObject({ field: "png:idat-order" });
  });
  it("중복 헤더·알 수 없는 필수 chunk·APNG를 명시적으로 거부한다", async () => {
    for (const extra of [pngHeader(gray), pngChunk("TEST", new Uint8Array()), pngChunk("acTL", new Uint8Array(8))]) await expect(validate(pngFile([pngHeader(gray), extra, pngChunk("IDAT", deflateSync(new Uint8Array([0,1,2,3,4]))), pngChunk("IEND", new Uint8Array())]))).rejects.toMatchObject({ code: "material_content_invalid" });
  });
  it("16-bit RGBA를 전체 픽셀 이미지 생성 없이 해석한다", async () => {
    const bytes: Buffer = pngImage({ width: 1, height: 1, depth: 16, color: 6, interlace: 0 }, new Uint8Array([0,255,255,0,0,0,0,255,255]));
    expect((await validate(bytes)).image.decodedBytes).toBe(8);
  });
  it("zlib 종료 뒤 숨겨진 압축 데이터와 비연속 IDAT를 거부한다", async () => {
    const compressed: Buffer = deflateSync(new Uint8Array([0,1,2,3,4]));
    const trailing: Buffer = pngFile([pngHeader(gray), pngChunk("IDAT", Buffer.concat([compressed, Buffer.from([1,2,3])])), pngChunk("IEND", new Uint8Array())]);
    await expect(validate(trailing)).rejects.toMatchObject({ code: "material_content_invalid" });
    const split: Buffer = pngFile([pngHeader(gray), pngChunk("IDAT", compressed.subarray(0,4)), pngChunk("tEXt", Buffer.from("note\\0text")), pngChunk("IDAT", compressed.subarray(4)), pngChunk("IEND", new Uint8Array())]);
    await expect(validate(split)).rejects.toMatchObject({ code: "material_content_invalid" });
  });
  it("체크섬 불일치와 취소를 성공으로 표시하지 않는다", async () => {
    await expect(validatePngContent(pngSource(good, 1), { ...pngMetadata(good), sha256: "0".repeat(64) }, new AbortController().signal)).rejects.toMatchObject({ code: "material_checksum_mismatch" });
    const aborted: AbortController = new AbortController(); aborted.abort();
    await expect(validatePngContent(pngSource(good, 1), pngMetadata(good), aborted.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
