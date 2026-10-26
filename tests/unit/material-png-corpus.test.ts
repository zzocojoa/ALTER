import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import corpus from "../fixtures/pngsuite/manifest.json";
import oracle from "../fixtures/pngsuite/pixel-oracle.json";
import { validatePngContent } from "../../lib/materials/png-content";
import { pngMetadata, pngSource } from "../fixtures/png-bytes";

function fixture(file: string): Buffer { return readFileSync(new URL(`../fixtures/pngsuite/${file}`, import.meta.url)); }
async function inspect(file: string): Promise<Awaited<ReturnType<typeof validatePngContent>>> {
  const bytes: Buffer = fixture(file);
  return validatePngContent(pngSource(bytes, 7), pngMetadata(bytes), new AbortController().signal);
}
describe("독립 PngSuite corpus", () => {
  it.each(corpus.fixtures)("$file의 공식 정상·손상 판정을 따른다", async ({ file, sha256, valid }) => {
    expect(createHash("sha256").update(fixture(file)).digest("hex")).toBe(sha256);
    if (!valid) { await expect(inspect(file)).rejects.toMatchObject({ code: "material_content_invalid" }); return; }
    const result = await inspect(file);
    expect(result.image.pixels).toBeGreaterThan(0); expect(result.image.maximumInflateChunkBytes).toBeLessThanOrEqual(65536);
  });
  it.each(oracle.fixtures)("$file의 복원 픽셀을 독립 libpng 디코더와 대조한다", async ({ file, width, height, channels, scanlineSha256 }) => {
    const proof = (await inspect(file)).image;
    expect(proof).toMatchObject({ width, height, decodedBytes: width * height * channels, scanlineSha256 });
  });
});
