import { z } from "zod";
import probes from "./text-probes.json";
import { materialFailure, requireMaterialBodyLength } from "./policy";
import type { MaterialMetadata } from "./policy";

export type TextProbe = Readonly<(typeof probes)[number]>;
export const textProbes: readonly TextProbe[] = probes;
export function textProbeMetadata(request: Request): MaterialMetadata {
  const fixture: TextProbe | undefined = textProbes.find((item: TextProbe): boolean => item.id === request.headers.get("x-text-probe"));
  if (fixture === undefined) throw materialFailure("material_metadata_invalid", "text-probe", 400);
  if (request.headers.get("content-type") !== "text/plain") throw materialFailure("material_type_mismatch", "Content-Type", 415);
  requireMaterialBodyLength(request.headers.get("content-length"), fixture.bytes);
  return { title: fixture.title, edition: "", role: "reference", kind: "text", filename: `${fixture.id}.txt`, mime: "text/plain", bytes: fixture.bytes, sha256: fixture.sha256 };
}
const resultSchema = z.object({ kind: z.literal("text"), encoding: z.literal("utf-8"), pages: z.literal(1), transfer: z.object({ bytes: z.number(), sha256: z.string(), maximumReadBufferBytes: z.number().positive().max(65536) }) });
export function requireTextProbeResult(fixture: TextProbe, status: number, value: unknown): void {
  if (status !== fixture.status) throw new Error(`텍스트 검사 응답 상태가 다릅니다: ${fixture.id}, HTTP ${status}`);
  if (fixture.status !== 200) {
    const rejected = z.object({ error: z.literal("material_content_invalid"), field: z.literal(fixture.field) }).safeParse(value);
    if (!rejected.success) throw new Error(`텍스트 거부 사유가 다릅니다: ${fixture.id}`, { cause: rejected.error });
    return;
  }
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error(`텍스트 검사 증거가 없습니다: ${fixture.id}`, { cause: parsed.error });
  if (parsed.data.transfer.bytes !== fixture.bytes || parsed.data.transfer.sha256 !== fixture.sha256) throw new Error(`텍스트 검사 증거가 원본과 다릅니다: ${fixture.id}`);
}
