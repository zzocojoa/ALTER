import { z } from "zod";
import probes from "./pdf-probes.json";
import { materialFailure, requireMaterialBodyLength } from "./policy";
import type { MaterialMetadata } from "./policy";

export type PdfProbe = Readonly<(typeof probes)[number]>;
export const pdfProbes: readonly PdfProbe[] = probes;
export function pdfProbeMetadata(request: Request): MaterialMetadata {
  const fixture: PdfProbe | undefined = pdfProbes.find((item: PdfProbe): boolean => item.id === request.headers.get("x-pdf-probe"));
  if (fixture === undefined) throw materialFailure("material_metadata_invalid", "pdf-probe", 400);
  if (request.headers.get("content-type") !== "application/pdf") throw materialFailure("material_type_mismatch", "Content-Type", 415);
  requireMaterialBodyLength(request.headers.get("content-length"), fixture.bytes);
  return { title: fixture.title, edition: "", role: "reference", kind: "pdf", filename: `${fixture.id}.pdf`, mime: "application/pdf", bytes: fixture.bytes, sha256: fixture.sha256 };
}
const resultSchema = z.object({ transfer: z.object({ bytes: z.number(), sha256: z.string(), maximumReadBufferBytes: z.number().positive().max(65536) }), pdf: z.object({ pages: z.number().int().positive().max(500), rangeReads: z.number().int().positive(), maximumRangeBytes: z.number().positive().max(65536), wasmMemoryBytes: z.number().positive().max(67108864), originalFileAccumulated: z.literal(false), encodedImagePixelsDecoded: z.literal(false) }), cleanup: z.literal("passed"), accountQuotaVerified: z.literal(false) });
/** 고정 원본과 실제 R2 Range 구조 증거를 대조합니다. 계정 잔여 용량 확인으로 해석하지 않습니다. */
export function requirePdfProbeResult(fixture: PdfProbe, status: number, value: unknown): void {
  if (status !== fixture.status) throw new Error(`PDF 검사 응답 상태가 다릅니다: ${fixture.id}, HTTP ${status}`);
  if (fixture.status !== 200) {
    const rejected = z.object({ error: z.literal("material_content_invalid"), field: z.literal(fixture.field) }).safeParse(value);
    if (!rejected.success) throw new Error(`PDF 거부 사유가 다릅니다: ${fixture.id}`, { cause: rejected.error });
    return;
  }
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error(`PDF 검사 응답 형식이 올바르지 않습니다: ${fixture.id}`, { cause: parsed.error });
  if (parsed.data.transfer.bytes !== fixture.bytes || parsed.data.transfer.sha256 !== fixture.sha256 || parsed.data.pdf.pages !== fixture.pages) throw new Error(`PDF 검사 증거가 원본과 일치하지 않습니다: ${fixture.id}`);
}
