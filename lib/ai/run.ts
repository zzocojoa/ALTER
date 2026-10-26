import { coffeeProbeReceipt, coffeeProbeUnit, requireCoffeeBound } from "./coffee-probe.ts";
import { requireDispatchPricing } from "./pricing.ts";
import { executeAiAttempt } from "./attempt.ts";
import type { AttemptRuntime, AiAttemptOutcome, AiAttemptExecutor } from "./attempt.ts";
import { completeAiDelivery } from "./complete.ts";
import type { CompletionRuntime } from "./complete.ts";
import type { LearningKind, LearningOutput } from "./learning-contract.ts";
import { pricingVersion, requireVerifiedPricing } from "./pricing.ts";
import type { PricingVersion } from "./pricing.ts";
import { modelRequest, prepareAiRequest } from "./request-bound.ts";
import type { ModelRequest, PreparedAiRequest } from "./request-bound.ts";
import { decideAiRetry, isAiTransportFailure } from "./retry.ts";
import type { RetryWarning } from "./retry.ts";
import { currentAiWindow } from "../../db/repositories/ai-window.ts";
import { domainFailure } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";

export type AiRunInput = Readonly<{ logicalRequestKey: string; request: ModelRequest; pricing: PricingVersion; expectedKind: LearningKind }>;
export type AiRunRuntime = AttemptRuntime & CompletionRuntime & Readonly<{
  requireSupport: (owner: SiteIdentity, request: PreparedAiRequest, now: number) => Promise<void>;
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  warn: (warning: RetryWarning) => void;
}>;
export type AiRunOutcome = Readonly<{ kind: "validated"; callId: string; output: LearningOutput }> | Extract<AiAttemptOutcome, { kind: "existing" }>;

export type AiSequenceRuntime = Omit<AiRunRuntime, "requireSupport">;

/** 학습 호출은 실제 계정 지원 증거를 요구하며 최초 검사는 고정 검사 요청만 별도로 연결합니다. */
export async function runAiRequest(runtime: AiRunRuntime, value: AiRunInput, signal: AbortSignal): Promise<AiRunOutcome> {
  const input: AiRunInput = { ...value, request: modelRequest.parse(value.request), pricing: pricingVersion.parse(value.pricing) };
  const owner: SiteIdentity = await runtime.authenticate();
  if (input.pricing.purpose && runtime.coffeeProbeApproval) return runCoffeeProbeRequest(runtime, input, owner, signal);
  requireVerifiedPricing(input.pricing, runtime.now());
  const prepared: PreparedAiRequest = await prepareAiRequest(input.request);
  await runtime.requireSupport(owner, prepared, runtime.now());
  return runAiAttemptSequence({ ...runtime, authenticate: async (): Promise<SiteIdentity> => {
    const current: SiteIdentity = await runtime.authenticate();
    if (current.userId !== owner.userId) throw domainFailure("reference_conflict", "ai.owner.changed", null);
    return current;
  } }, input, executeAiAttempt, signal);
}

/** 같은 실행 안에서만 새 시도를 허용하며 조회·중복 제출은 외부 생성으로 이어지지 않습니다. */
export async function runAiAttemptSequence(runtime: AiSequenceRuntime, value: AiRunInput, execute: AiAttemptExecutor, signal: AbortSignal): Promise<AiRunOutcome> {
  const input: AiRunInput = { ...value, request: modelRequest.parse(value.request), pricing: pricingVersion.parse(value.pricing) };
  const owner: SiteIdentity = await runtime.authenticate();
  for (let ordinal: number = 1; ordinal <= 3; ordinal += 1) {
    signal.throwIfAborted();
    const window = await currentAiWindow(runtime.db, owner, runtime.now());
    let outcome: AiAttemptOutcome;
    try {
      outcome = await execute({ ...runtime, authenticate: async (): Promise<SiteIdentity> => {
        const current: SiteIdentity = await runtime.authenticate();
        if (current.userId !== owner.userId) throw domainFailure("reference_conflict", "ai.owner.changed", null);
        return current;
      } }, { ...input, attemptOrdinal: ordinal, windowId: window.id, windowVersion: window.version }, signal);
    } catch (error: unknown) {
      if (!isAiTransportFailure(error)) throw error;
      const decision = decideAiRetry(error, ordinal, runtime.now());
      if (!decision.retry || signal.aborted) throw error;
      runtime.warn({ event: "ai_retry_reserved_separately", logicalRequestKey: input.logicalRequestKey, failedAttempt: ordinal, nextAttempt: ordinal + 1, callId: error.callId, status: error.status, delayMs: decision.delayMs, previousReservation: error.reservationId === null ? "none" : "retained-unknown" });
      await runtime.wait(decision.delayMs, signal);
      continue;
    }
    if (outcome.kind === "existing") return outcome;
    return { kind: "validated", callId: outcome.call.id, output: await completeAiDelivery(runtime, outcome, input.expectedKind) };
  }
  throw domainFailure("result_unknown", "ai.retry.exhausted", null);
}

/** 승인 범위·토큰 상한을 매 시도 다시 확인하며 예약 원장의23단계 제한과 누적 달러 상한을 함께 적용합니다. */
async function runCoffeeProbeRequest(runtime: AiRunRuntime, input: AiRunInput, owner: SiteIdentity, signal: AbortSignal): Promise<AiRunOutcome> {
  const approval = runtime.coffeeProbeApproval;
  if (!approval || !input.request.responseContract) throw domainFailure("reference_conflict", "coffee.approval-required", null);
  requireDispatchPricing(input.pricing, runtime.now());
  const prepared = await prepareAiRequest(input.request);
  const unitId = coffeeProbeUnit(approval, await runtime.loadContext(owner), input.request, runtime.now());
  await runtime.requireSupport(owner, prepared, runtime.now());
  return runAiAttemptSequence({ ...runtime,
    authorizeSources: async (identity, actual): Promise<void> => {
      if (identity.userId !== owner.userId || actual.requestFingerprint !== prepared.requestFingerprint || coffeeProbeUnit(approval, await runtime.loadContext(identity), actual.request, runtime.now()) !== unitId) throw domainFailure("reference_conflict", "coffee.request-changed", null);
      await runtime.authorizeSources(identity, actual);
    },
    checkFunding: async (identity, bound, now) => {
      requireCoffeeBound(input.request, bound);
      const funding = await runtime.checkFunding(identity, bound, now);
      if (funding.prepaidProbe?.limitUsdMicros !== 300000) throw domainFailure("reference_conflict", "coffee.approved-budget-required", null);
      return { ...funding, coffeeProbe: coffeeProbeReceipt.parse({ approvalId: approval.id, logicalRequestKey: input.logicalRequestKey, requestFingerprint: prepared.requestFingerprint, unitId, kind: input.expectedKind }) };
    },
  }, input, executeAiAttempt, signal);
}
