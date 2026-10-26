import { contentHash, recordId, timestamp, studyDate } from "../domain/contracts.ts";
import { z } from "zod";
import { coffeeProbeApproval } from "./coffee-probe.ts";
import { fundingSnapshot } from "./funding.ts";
import { pricingVersion } from "./pricing.ts";
import { supportObservation } from "./support.ts";

export const handwritingProbeApproval = z.object({ sessionId: recordId, materialId: recordId, imageSha256: z.string().regex(/^[a-f0-9]{64}$/), requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/), approvedAt: timestamp, validUntil: timestamp }).strict().refine((value): boolean => value.validUntil > value.approvedAt);
export type HandwritingProbeApproval = Readonly<z.infer<typeof handwritingProbeApproval>>;
export const scheduledReviewProbeApproval = z.object({ sessionId: recordId, reviewId: recordId, scheduleId: recordId, basisResultVersionId: recordId, dueDate: studyDate, notBeforeDate: studyDate.refine((value): boolean => value >= "2026-10-26"), requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/), approvedAt: timestamp, validUntil: timestamp }).strict().refine((value): boolean => value.validUntil > value.approvedAt && value.dueDate >= value.notBeforeDate);
export type ScheduledReviewProbeApproval = Readonly<z.infer<typeof scheduledReviewProbeApproval>>;
export const pageVisionProbeApproval = z.object({ materialId: recordId, originalHash: z.string().regex(/^[a-f0-9]{64}$/), filePage: z.number().int().min(1).max(500), imageSha256: z.string().regex(/^[a-f0-9]{64}$/), requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/), approvedAt: timestamp, validUntil: timestamp }).strict().refine((value): boolean => value.validUntil > value.approvedAt);
export type PageVisionProbeApproval = Readonly<z.infer<typeof pageVisionProbeApproval>>;
export const aiConfiguration = z.object({ credentialFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(), pricing: pricingVersion, funding: fundingSnapshot, support: z.array(supportObservation).max(100), coffeeProbeApproval: coffeeProbeApproval.optional(), handwritingProbeApproval: handwritingProbeApproval.optional(), scheduledReviewProbeApproval: scheduledReviewProbeApproval.optional(), pageVisionProbeApproval: pageVisionProbeApproval.optional() }).strict().refine((value): boolean => Boolean(value.pricing.purpose) === Boolean(value.funding.prepaidProbe) && (!value.coffeeProbeApproval || value.funding.prepaidProbe?.limitUsdMicros === 300000) && (!(value.coffeeProbeApproval || value.handwritingProbeApproval || value.scheduledReviewProbeApproval || value.pageVisionProbeApproval) || value.pricing.purpose === "prepaid-probe") && (!value.handwritingProbeApproval || !value.scheduledReviewProbeApproval || value.handwritingProbeApproval.sessionId !== value.scheduledReviewProbeApproval.sessionId));
export type AiConfiguration = Readonly<z.infer<typeof aiConfiguration>>;
/** 계정·요금·잔액 증거는 서버 설정에서만 읽고 누락을 임의 가격이나 무료 잔액으로 대체하지 않습니다. */
export function requireAiConfiguration(raw: string | undefined): AiConfiguration {
  if (!raw) throw Object.assign(new Error("AI 운영 설정 누락: ALTER_AI_CONFIGURATION. 가격·환율·세금·잔액·실제 지원 증거가 필요합니다."), { name: "AiConfigurationFailure", code: "ai_configuration_required" });
  return aiConfiguration.parse(JSON.parse(raw));
}

/** 기존 로컬 키와의 일치 여부만 확인하며 값·해시·키 일부를 응답이나 로그에 노출하지 않습니다. */
export async function requireConfiguredKey(key: string, expectedFingerprint: string | undefined): Promise<void> {
  if (expectedFingerprint === undefined) return;
  if (await contentHash(key) !== expectedFingerprint) throw Object.assign(new Error("운영 키가 확인된 기존 키와 다릅니다. 공식 비밀값 입력란의 내용을 확인하세요."), { code: "ai_key_mismatch", hasWhitespace: /\s/.test(key), hasAssignmentPrefix: key.startsWith("OPENAI_API_KEY="), hasQuotes: /[\x22\x27]/.test(key), hasProjectKeyPrefix: key.startsWith("sk-proj-") });
}
