import { z } from "zod";
import { aiCapability, requireAiSupport } from "../ai/support.ts";
import type { AiConfiguration } from "../ai/configuration.ts";

export const publicSupportCondition = z.object({ capability: aiCapability, state: z.enum(["verified", "unverified", "denied"]), validUntil: z.number().int().nonnegative().nullable() }).strict();
export type PublicSupportCondition = Readonly<z.infer<typeof publicSupportCondition>>;

/** 계정 지문·응답 ID 없이 현재 계정에서 관측한 기능별 지원 상태만 공개합니다. */
export function publicAiSupport(configuration: AiConfiguration | null, now: number): PublicSupportCondition[] {
  if (configuration === null) return [];
  return aiCapability.options.map((capability): PublicSupportCondition => {
    const latest = configuration.support.filter((item): boolean => item.capability === capability && item.accountFingerprint === configuration.funding.accountFingerprint && item.environment === "hosted-worker" && item.checkedAt <= now).sort((left, right): number => right.checkedAt - left.checkedAt)[0];
    try { requireAiSupport(configuration.support, [capability], configuration.funding.accountFingerprint, now); return { capability, state: "verified", validUntil: latest.validUntil }; }
    catch (error: unknown) {
      if (!(error instanceof Error) || !("code" in error) || !["ai_support_unverified", "ai_support_denied"].includes(String(error.code))) throw error;
      return { capability, state: error.code === "ai_support_denied" ? "denied" : "unverified", validUntil: latest?.validUntil ?? null };
    }
  });
}
