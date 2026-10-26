import { z } from "zod";
import { recordId } from "../domain/contracts.ts";
import { extractedSegment, pageResult, validatePageResult } from "./result.ts";
import { pageRotation } from "./image.ts";
import { extractionLimits } from "./selection.ts";

export const visionBinding = z.object({ materialId: recordId, originalVersion: z.string().min(1).max(300), originalHash: z.string().regex(/^[a-f0-9]{64}$/), selectionRevision: z.number().int().positive(), filePage: z.number().int().min(1).max(500), imageSha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive().max(extractionLimits.imageLongSide), height: z.number().int().positive().max(extractionLimits.imageLongSide), rotation: pageRotation }).strict();
export type VisionBinding = Readonly<z.infer<typeof visionBinding>>;
export const pageVision = z.object({ kind: z.literal("page-vision"), binding: visionBinding, page: pageResult.extend({ segments: z.array(extractedSegment.extend({ transform: z.null() }).strict()).max(1000), method: z.literal("vision"), status: z.enum(["complete", "blank", "unreadable"]), error: z.null() }).strict() }).strict();
export type PageVision = Readonly<z.infer<typeof pageVision>>;

/** 모델의 출처 주장은 서버가 전송한 한 페이지의 불변 결합값과 전부 대조합니다. */
export function validatePageVision(value: PageVision, expected: VisionBinding): void {
  if (Object.entries(expected).some(([key, item]): boolean => value.binding[key as keyof VisionBinding] !== item) || value.page.width !== expected.width || value.page.height !== expected.height || value.page.rotation !== expected.rotation) throw Object.assign(new Error("비전 응답의 페이지 연결이 요청과 다릅니다."), { code: "ai_semantic_invalid", rule: "source_mismatch" });
  try { validatePageResult(value.page, expected.filePage); }
  catch (error: unknown) { throw Object.assign(new Error("비전 응답의 내용과 좌표를 확인할 수 없습니다.", { cause: error }), { code: "ai_semantic_invalid", rule: "source_mismatch" }); }
}
