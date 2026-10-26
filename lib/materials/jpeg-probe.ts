import { z } from "zod";
import probes from "./jpeg-probes.json";
import { materialFailure, requireMaterialBodyLength } from "./policy";
import type { MaterialMetadata } from "./policy";

export type JpegProbe = Readonly<(typeof probes)[number]>;
export const jpegProbes: readonly JpegProbe[] = probes;
export function jpegProbeMetadata(request: Request): MaterialMetadata {
  const fixture: JpegProbe | undefined = jpegProbes.find((item: JpegProbe): boolean => item.id === request.headers.get("x-jpeg-probe"));
  if (fixture === undefined) throw materialFailure("material_metadata_invalid", "jpeg-probe", 400);
  if (request.headers.get("content-type") !== "image/jpeg") throw materialFailure("material_type_mismatch", "Content-Type", 415);
  requireMaterialBodyLength(request.headers.get("content-length"), fixture.bytes);
  return { title: fixture.title, edition: "", role: "reference", kind: "image", filename: `${fixture.id}.jpg`, mime: "image/jpeg", bytes: fixture.bytes, sha256: fixture.sha256 };
}
const resultSchema = z.object({ kind: z.literal("image"), mime: z.literal("image/jpeg"), pages: z.literal(1), transfer: z.object({ bytes: z.number(), sha256: z.string(), maximumReadBufferBytes: z.number().positive().max(65536) }), image: z.object({ pixels: z.number(), decodedBytes: z.number(), maximumRowBytes: z.number().positive().max(262144), maximumInputWindowBytes: z.number().positive().max(65536), wasmMemoryBytes: z.number().positive().max(67108864), coefficientBytes: z.number().nonnegative().max(50331648), scanlineSha256: z.string() }) });
/** 실제 원본·픽셀 해시와 입력·계수·WASM 메모리 증거를 독립 기준과 대조합니다. */
export function requireJpegProbeResult(fixture: JpegProbe, status: number, value: unknown): void {
  if (status !== fixture.status) throw new Error(`JPEG 검사 응답 상태가 다릅니다: ${fixture.id}, HTTP ${status}`);
  if (fixture.status !== 200) {
    const rejected = z.object({ error: z.literal("material_content_invalid"), field: z.literal(fixture.field) }).safeParse(value);
    if (!rejected.success) throw new Error(`JPEG 거부 사유가 다릅니다: ${fixture.id}`, { cause: rejected.error });
    return;
  }
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error(`JPEG 검사 응답 형식이 올바르지 않습니다: ${fixture.id}`, { cause: parsed.error });
  if (parsed.data.transfer.bytes !== fixture.bytes || parsed.data.transfer.sha256 !== fixture.sha256 || parsed.data.image.pixels !== fixture.pixels || parsed.data.image.decodedBytes !== fixture.decodedBytes || parsed.data.image.scanlineSha256 !== fixture.scanlineSha256) throw new Error(`JPEG 검사 증거가 원본과 일치하지 않습니다: ${fixture.id}`);
}
