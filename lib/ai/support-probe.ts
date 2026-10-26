import { recoverAiResponse } from "./recover.ts";
import { requireAiOutputLimit } from "./response.ts";
import { executeAiAttempt } from "./attempt.ts";
import type { AiAttemptExecutor, AiAttemptOutcome } from "./attempt.ts";
import { executeAiStreamAttempt, executeInterruptedAiStreamAttempt } from "./stream.ts";
import { runAiAttemptSequence } from "./run.ts";
import type { AiSequenceRuntime } from "./run.ts";
import { prepareAiRequest, prepareAiStreamingRequest } from "./request-bound.ts";
import type { ModelRequest, RequestBound } from "./request-bound.ts";
import { learningOutput } from "./learning-contract.ts";
import type { LearningContext } from "./learning-contract.ts";
import { requireFundingSnapshot, monthlyCommittedUnits } from "./funding.ts";
import { requireDispatchPricing } from "./pricing.ts";
import type { AiConfiguration } from "./configuration.ts";
import { aiSupportContract, supportObservation } from "./support.ts";
import type { AiCapability, SupportObservation } from "./support.ts";
import { contentHash, domainFailure, policy } from "../domain/contracts.ts";
import { readAiRequestStatus } from "../../db/repositories/ai-status.ts";
import type { AiRequestState } from "../../db/repositories/ai-status.ts";
import { readAiCostIntent } from "../../db/repositories/ai-cost.ts";
import { isAiTransportFailure } from "./retry.ts";

type ProbeName = "text" | "image" | "stream" | "stream-interruption";
type Probe = Readonly<{ name: ProbeName; request: ModelRequest; expected: string; execute: AiAttemptExecutor; capabilities: readonly AiCapability[] }>;
export type AiSupportProbeReport = Readonly<{ status: "passed"; environment: SupportObservation["environment"]; model: string; runKey: string; checkedAt: number; observations: readonly SupportObservation[]; checks: readonly Readonly<{ name: ProbeName; attempts: readonly AiRequestState[] }>[]; costKind: "usage-calculated-not-provider-invoice" }>;
const redImage: string = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";

function textRequest(answer: string): ModelRequest {
  return { instructions: 'This is a fixed ALTER connectivity test. Return exactly a result object with kind "diagnostic-question", waitForAnswer true, and question equal to the requested test answer. Do not add explanations.', messages: [{ role: "user", content: [{ type: "input_text", text: `Test answer: ${answer}` }] }], maximumOutputTokens: 512, reasoningEffort: "none" };
}

/** 사용자 자료를 읽지 않는 고정 질문과 서버 제작 단색 이미지로만 최초 지원을 검사합니다. */
function probes(): readonly Probe[] {
  const image: ModelRequest = { ...textRequest(""), messages: [{ role: "user", content: [{ type: "input_text", text: "Identify the dominant color of the attached image. The test answer is the lowercase English color name, with no punctuation." }, { type: "input_image", sourceRefId: "00000000-0000-4000-8000-000000000412" as ReturnType<typeof import("../domain/contracts.ts").recordId.parse>, dataUrl: redImage, width: 32, height: 32, bytes: 97, detail: "low" }] }] };
  return [
    { name: "text", request: textRequest("ALTER_TEXT_OK"), expected: "ALTER_TEXT_OK", execute: executeAiAttempt, capabilities: ["text", "structured-output", "usage", "output-limit"] },
    { name: "image", request: image, expected: "red", execute: executeAiAttempt, capabilities: ["image"] },
    { name: "stream", request: textRequest("ALTER_STREAM_OK"), expected: "ALTER_STREAM_OK", execute: executeAiStreamAttempt, capabilities: ["streaming"] },
    { name: "stream-interruption", request: textRequest("ALTER_INTERRUPT_OK"), expected: "ALTER_INTERRUPT_OK", execute: executeInterruptedAiStreamAttempt, capabilities: [] },
  ];
}

/** 검사 결과를 학습 기록으로 확정하지 않으며 비어 있는 검사 전용 문맥만 사용합니다. */
function probeContext(): LearningContext {
  return { pages: [], sources: [], unitIds: [], latestResult: null, latestEvidence: [], attempts: [], currentCorrectionId: null, expectedHelpStage: "direction", feedbackIds: [], revision: null, relatedReviews: [], errorId: null, availableMinutesPerWeek: 0, delayedRecallDueAt: null };
}

/** 출력 제한 반영 확인도 사용량 정산 후의 검증 단계에서 실행합니다. */
function requireEchoedLimit(execute: AiAttemptExecutor): AiAttemptExecutor {
  return async (runtime, input, signal): Promise<AiAttemptOutcome> => {
    const delivery = await execute(runtime, input, signal);
    if (delivery.kind === "existing") return delivery;
    return { ...delivery, parse: async () => {
      requireAiOutputLimit(delivery.raw, input.request.maximumOutputTokens);
      return delivery.parse();
    } };
  };
}

/** 지원 증거가 없는 최초 검사만 고정 요청으로 허용하고 실제 비용·중복 방지는 공통 경로를 사용합니다. */
export async function runAiSupportProbe(runtime: AiSequenceRuntime, configuration: AiConfiguration, environment: SupportObservation["environment"], signal: AbortSignal): Promise<AiSupportProbeReport> {
  const owner = await runtime.authenticate();
  const now: number = runtime.now();
  const pricing = requireDispatchPricing(configuration.pricing, now);
  const funding = requireFundingSnapshot(configuration.funding, owner.userId, pricing.id, now);
  if (monthlyCommittedUnits(funding, now) > policy.operationsMonthlyKrw * policy.moneyScale) throw domainFailure("limit_exceeded", "ai.probe.monthly-payment", null);
  const runKey: string = `support-v1:${await contentHash({ account: funding.accountFingerprint, funding: funding.id, pricing: pricing.id })}`;
  const observations: SupportObservation[] = [];
  const checks: { name: ProbeName; attempts: readonly AiRequestState[] }[] = [];
  for (const probe of probes()) {
    signal.throwIfAborted();
    const fingerprints: readonly string[] = [(await prepareAiRequest(probe.request)).requestFingerprint, (await prepareAiStreamingRequest(probe.request)).requestFingerprint];
    const logicalRequestKey: string = `${runKey}:${probe.name}`;
    const scoped: AiSequenceRuntime = { ...runtime, authenticate: async () => {
      const current = await runtime.authenticate();
      if (current.userId !== owner.userId) throw domainFailure("reference_conflict", "ai.probe.owner", null);
      return current;
    }, authorizeSources: async (current, prepared): Promise<void> => {
      if (current.userId !== owner.userId || !fingerprints.includes(prepared.requestFingerprint)) throw domainFailure("validation", "ai.probe.fixed-source", null);
    }, checkFunding: async (current, bound, checkedAt) => {
      if (bound.amount.units > 10 * policy.moneyScale) throw domainFailure("limit_exceeded", "ai.probe.ten-won-attempt-cap", null);
      return runtime.checkFunding(current, bound, checkedAt);
    }, loadContext: async (): Promise<LearningContext> => probeContext() };
    try {
      await runAiAttemptSequence(scoped, { logicalRequestKey, request: probe.request, pricing, expectedKind: "diagnostic-question" }, requireEchoedLimit(probe.execute), signal);
    } catch (error: unknown) {
      if (probe.name !== "stream-interruption" || signal.aborted || !isAiTransportFailure(error) || error.category !== "cancelled") throw error;
    }
    const saved: AiRequestState | undefined = (await readAiRequestStatus(runtime.db, owner, logicalRequestKey)).at(-1);
    if (probe.name !== "stream-interruption" && saved?.responseId && saved.callId && saved.stage !== null && ["usage-stored", "response-received", "unknown", "settled"].includes(saved.stage)) {
      await recoverAiResponse(scoped, saved.callId, "diagnostic-question", signal);
    }
    const attempts: readonly AiRequestState[] = await readAiRequestStatus(runtime.db, owner, logicalRequestKey);
    const latest: AiRequestState | undefined = attempts.at(-1);
    if (!latest?.responseId) throw domainFailure("result_unknown", "ai.probe.response-id-required", null);
    if (probe.name === "stream-interruption") {
      if (latest.stage !== "unknown" || latest.reservationState !== "unknown" || latest.outstandingReservedUnits <= 0 || latest.automaticReplayAllowed !== false) throw domainFailure("result_unknown", "ai.probe.interruption-not-preserved", null);
    } else {
      if (latest.stage !== "validated" || latest.reservationState !== "settled" || latest.actualUnits === null || !latest.result) throw domainFailure("result_unknown", "ai.probe.settlement-required", null);
      const output = learningOutput.parse(JSON.parse(latest.result));
      if (output.result.kind !== "diagnostic-question" || output.result.question !== probe.expected) throw domainFailure("validation", "ai.probe.answer-mismatch", null);
      const intent = await readAiCostIntent(runtime.db, owner, "openai.response", `${logicalRequestKey}:${latest.attemptOrdinal}`);
      if (!intent) throw domainFailure("reference_conflict", "ai.probe.reservation", null);
      const bound: RequestBound = JSON.parse(intent.bound) as RequestBound;
      const checkedAt: number = bound.computedAt;
      for (const capability of probe.capabilities) observations.push(supportObservation.parse({ capability, model: aiSupportContract.model, sdkVersion: aiSupportContract.sdkVersion, accountFingerprint: funding.accountFingerprint, environment, result: "supported", responseId: latest.responseId, checkedAt, validUntil: checkedAt + 86_400_000 }));
    }
    checks.push({ name: probe.name, attempts });
  }
  return { status: "passed", environment, model: aiSupportContract.model, runKey, checkedAt: runtime.now(), observations, checks, costKind: "usage-calculated-not-provider-invoice" };
}
