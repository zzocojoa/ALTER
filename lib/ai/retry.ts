import { z } from "zod";
import type { AiTransportFailure } from "./attempt.ts";

export type RetryDecision = Readonly<{ retry: true; delayMs: number }> | Readonly<{ retry: false; reason: "not-transient" | "attempts-exhausted" | "retry-after-invalid" | "retry-after-too-long" }>;
export type RetryWarning = Readonly<{ event: "ai_retry_reserved_separately"; logicalRequestKey: string; failedAttempt: number; nextAttempt: number; callId: string | null; status: number | null; delayMs: number; previousReservation: "retained-unknown" | "none" }>;

export function isAiTransportFailure(error: unknown): error is AiTransportFailure {
  return error instanceof Error && "code" in error && error.code === "ai_transport_failed";
}
/** 제공자가 요구한 대기보다 일찍 재시도하지 않으며 긴 대기는 명시적으로 중단합니다. */
export function decideAiRetry(error: AiTransportFailure, ordinal: number, now: number): RetryDecision {
  z.number().int().min(1).max(3).parse(ordinal);
  if (ordinal === 3) return { retry: false, reason: "attempts-exhausted" };
  if (error.category !== "network" && !(error.category === "http" && error.status !== null && (error.status === 429 || error.status >= 500 && error.status <= 599))) return { retry: false, reason: "not-transient" };
  if (["insufficient_quota", "billing_hard_limit_reached", "model_not_found", "permission_denied"].includes(error.providerCode ?? "")) return { retry: false, reason: "not-transient" };
  if (error.retryAfter === null) return { retry: true, delayMs: 1000 * 2 ** (ordinal - 1) };
  const text: string = error.retryAfter.trim();
  const milliseconds: number = /^\d+(\.\d+)?$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  if (!Number.isFinite(milliseconds)) return { retry: false, reason: "retry-after-invalid" };
  if (milliseconds > 30_000) return { retry: false, reason: "retry-after-too-long" };
  return { retry: true, delayMs: Math.max(0, Math.ceil(milliseconds)) };
}
