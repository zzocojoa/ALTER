import { z } from "zod";
import { policy, timestamp } from "../domain/contracts.ts";

export const aiCapability = z.enum(["text", "image", "structured-output", "streaming", "usage", "output-limit"]);
export type AiCapability = z.infer<typeof aiCapability>;
export const aiSupportContract = Object.freeze({
  model: policy.model,
  sdk: "openai",
  sdkVersion: "7.43.0",
  apiOrigin: "https://api.openai.com/v1",
  endpoint: "responses",
  maximumInputTokens: 922_000,
  maximumOutputTokens: 128_000,
  longContextThreshold: 272_000,
  sdkRetries: 0,
  browserAccess: false,
  modelTools: [] as readonly never[],
  sources: Object.freeze({
    model: "https://developers.openai.com/api/docs/models/gpt-6-luna",
    format: "https://developers.openai.com/api/docs/guides/structured-outputs",
    limits: "https://developers.openai.com/api/docs/guides/reasoning",
    sdk: "https://github.com/openai/openai-node/tree/v7.43.0",
  }),
} as const);

export const supportObservation = z.object({
  capability: aiCapability,
  model: z.literal(policy.model),
  sdkVersion: z.literal(aiSupportContract.sdkVersion),
  accountFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  environment: z.enum(["local-mock", "hosted-worker"]),
  result: z.enum(["supported", "unsupported"]),
  responseId: z.string().min(1).max(200).nullable(),
  checkedAt: timestamp,
  validUntil: timestamp,
}).strict().refine((value): boolean => value.validUntil > value.checkedAt);
export type SupportObservation = Readonly<z.infer<typeof supportObservation>>;
export type AiSupportFailure = Error & Readonly<{ code: "ai_support_unverified" | "ai_support_denied"; capability: AiCapability }>;

/** 문서·모의 응답을 계정 접근 증거로 승격하지 않으며 실제 검사는 예약 경로에서만 수행합니다. */
export function requireAiSupport(observations: readonly SupportObservation[], required: readonly AiCapability[], accountFingerprint: string, now: number): void {
  timestamp.parse(now);
  for (const capability of required) {
    const candidates: SupportObservation[] = observations.map((value): SupportObservation => supportObservation.parse(value))
      .filter((value): boolean => value.capability === capability && value.accountFingerprint === accountFingerprint && value.environment === "hosted-worker" && value.checkedAt <= now)
      .sort((left, right): number => right.checkedAt - left.checkedAt);
    const latest: SupportObservation | undefined = candidates[0];
    const code: AiSupportFailure["code"] | null = latest?.result === "unsupported" ? "ai_support_denied"
      : !latest || !latest.responseId || latest.validUntil <= now ? "ai_support_unverified" : null;
    if (code) throw Object.assign(new Error("지정 모델의 해당 기능을 예약된 실제 계정 검사로 확인해야 합니다."), { name: "AiSupportFailure", code, capability });
  }
}
