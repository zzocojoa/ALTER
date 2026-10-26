import { z } from "zod";
import probes from "./png-probes.json";
import { materialFailure, requireMaterialBodyLength } from "./policy";
import type { MaterialMetadata } from "./policy";

export type PngProbe = Readonly<(typeof probes)[number]>;
export const pngProbes: readonly PngProbe[] = probes;
export function pngProbeMetadata(request: Request): MaterialMetadata {
  const fixture: PngProbe | undefined = pngProbes.find((item: PngProbe): boolean => item.id === request.headers.get("x-png-probe"));
  if (fixture === undefined) throw materialFailure("material_metadata_invalid", "png-probe", 400);
  if (request.headers.get("content-type") !== "image/png") throw materialFailure("material_type_mismatch", "Content-Type", 415);
  requireMaterialBodyLength(request.headers.get("content-length"), fixture.bytes);
  return { title: fixture.title, edition: "", role: "reference", kind: "image", filename: `${fixture.id}.png`, mime: "image/png", bytes: fixture.bytes, sha256: fixture.sha256 };
}
const resultSchema = z.object({ kind: z.literal("image"), mime: z.literal("image/png"), pages: z.literal(1), transfer: z.object({ bytes: z.number(), sha256: z.string(), maximumReadBufferBytes: z.number().positive().max(65536) }), image: z.object({ pixels: z.number(), decodedBytes: z.number(), maximumRowBytes: z.number().positive().max(262144), maximumInflateChunkBytes: z.number().positive().max(65536) }) });
/** HTTP 성공뿐 아니라 원본 해시·실제 픽셀 수·행 버퍼 제한이 모두 일치해야 통과합니다. */
export function requirePngProbeResult(fixture: PngProbe, status: number, value: unknown): void {
  if (status !== fixture.status) throw new Error(`PNG 검사 응답 상태가 다릅니다: ${fixture.id}, HTTP ${status}`);
  if (fixture.status !== 200) {
    const rejected = z.object({ error: z.literal("material_content_invalid"), field: z.literal(fixture.field) }).safeParse(value);
    if (!rejected.success) throw new Error(`PNG 거부 사유가 다릅니다: ${fixture.id}`, { cause: rejected.error });
    return;
  }
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error(`PNG 검사 응답 형식이 올바르지 않습니다: ${fixture.id}`, { cause: parsed.error });
  if (parsed.data.transfer.bytes !== fixture.bytes || parsed.data.transfer.sha256 !== fixture.sha256 || parsed.data.image.pixels !== fixture.pixels || parsed.data.image.decodedBytes !== fixture.decodedBytes) throw new Error(`PNG 검사 증거가 원본과 일치하지 않습니다: ${fixture.id}`);
}
