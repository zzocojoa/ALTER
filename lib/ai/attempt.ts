import type { CoffeeProbeApproval } from "./coffee-probe.ts";
import { requireCurrentExecutionAuthority } from "../../db/repositories/restore-execution.ts";
import { parseResponse } from "openai/lib/ResponsesParser";
import type { FundingSnapshot } from "./funding.ts";
import OpenAI from "openai";
import type { APIError } from "openai";
import { z } from "zod";
import { createAiClient } from "./client.ts";
import type { ModelFetch } from "./client.ts";
import type { LearningOutput } from "./learning-contract.ts";
import { learningOutput } from "./learning-contract.ts";
import { aiSupportContract } from "./support.ts";
import { requireDispatchPricing } from "./pricing.ts";
import type { PricingVersion } from "./pricing.ts";
import { calculateRequestBound, prepareAiRequest, tokenCountPayload, verifyRequestBound } from "./request-bound.ts";
import type { ModelRequest, PreparedAiRequest, RequestBound } from "./request-bound.ts";
import { preserveAiUnknown, storeAiTransportEvidence } from "../../db/repositories/ai-settlement.ts";
import { beginAiDispatch } from "../../db/repositories/ai-call.ts";
import type { AiCallRow } from "../../db/repositories/ai-call.ts";
import { readAiCostIntent, reserveAiCost } from "../../db/repositories/ai-cost.ts";
import type { AiCostIntent } from "../../db/repositories/ai-cost.ts";
import { domainFailure, recordId, siteIdentity, version } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";

export type { ModelFetch } from "./client.ts";
export type AttemptRuntime = Readonly<{
  coffeeProbeApproval?: CoffeeProbeApproval;
  db: D1Database;
  authenticate: () => Promise<SiteIdentity>;
  authorizeSources: (owner: SiteIdentity, request: PreparedAiRequest) => Promise<void>;
  checkFunding: (owner: SiteIdentity, bound: RequestBound, now: number) => Promise<FundingSnapshot>;
  readApiKey: () => string;
  now: () => number;
  fetch: ModelFetch;
  reservationGuards?: (owner:SiteIdentity,requestId:string)=>readonly D1PreparedStatement[];
}>;
export type AiAttemptInput = Readonly<{ logicalRequestKey: string; attemptOrdinal: number; windowId: string; windowVersion: number; request: ModelRequest; pricing: PricingVersion }>;
export type AiDelivery = Readonly<{ kind: "received"; owner: SiteIdentity; call: AiCallRow; intent: AiCostIntent; bound: RequestBound; raw: unknown; status: number; providerRequestId: string | null; parse: () => Promise<LearningOutput> }>;
export type AiAttemptOutcome = AiDelivery | Readonly<{ kind: "existing"; intent: AiCostIntent }>;
export type AiTransportFailure = Error & Readonly<{ code: "ai_transport_failed"; stage: "token-count" | "response"; category: "network" | "http" | "cancelled" | "malformed"; status: number | null; providerCode: string | null; providerParam: string | null; providerRequestId: string | null; retryAfter: string | null; callId: string | null; owner: SiteIdentity; reservationId: string | null }>;

export function transportFailure(error: unknown, stage: AiTransportFailure["stage"], owner: SiteIdentity, reservationId: string | null): AiTransportFailure {
  const apiError: APIError | null = error instanceof OpenAI.APIError ? error : null;
  const providerCode: string | null = apiError?.code && /^[a-z_]{1,100}$/.test(apiError.code) ? apiError.code : null;
  const providerParam: string | null = apiError?.param && /^[A-Za-z0-9_.\[\]-]{1,150}$/.test(apiError.param) ? apiError.param : null;
  const category: AiTransportFailure["category"] = error instanceof OpenAI.APIUserAbortError ? "cancelled" : error instanceof OpenAI.APIConnectionError ? "network" : apiError ? "http" : "malformed";
  return Object.assign(new Error("OpenAI 요청을 완료하지 못했습니다. 저장된 시도와 예약 상태를 확인하세요."), { name: "AiTransportFailure", code: "ai_transport_failed" as const, stage, category, status: apiError?.status ?? null, providerCode, providerParam, providerRequestId: apiError?.requestID ?? null, retryAfter: apiError?.headers?.get("retry-after") ?? null, callId: reservationId, owner, reservationId });
}

export type ReservedAiDispatch = Readonly<{ kind: "reserved"; owner: SiteIdentity; call: AiCallRow; intent: AiCostIntent; bound: RequestBound; client: OpenAI }>;
export type AiAttemptExecutor = (runtime: AttemptRuntime, input: AiAttemptInput, signal: AbortSignal) => Promise<AiAttemptOutcome>;

/** 스트림과 비스트림의 인증·상한·원자적 예약·전송 의도 저장을 같은 경로로 수행합니다. */
export async function reserveAiDispatch(runtime: AttemptRuntime, input: AiAttemptInput, prepared: PreparedAiRequest, signal: AbortSignal): Promise<ReservedAiDispatch | Extract<AiAttemptOutcome, { kind: "existing" }>> {
  const owner: SiteIdentity = siteIdentity.parse(await runtime.authenticate());
  z.string().min(1).max(180).parse(input.logicalRequestKey); z.number().int().min(1).max(3).parse(input.attemptOrdinal);
  recordId.parse(input.windowId); version.parse(input.windowVersion);
  signal.throwIfAborted();
  await requireCurrentExecutionAuthority(runtime.db, owner);
  await runtime.authorizeSources(owner, prepared);
  const scope: string = "openai.response";
  const requestKey: string = `${input.logicalRequestKey}:${input.attemptOrdinal}`;
  const existing: AiCostIntent | null = await readAiCostIntent(runtime.db, owner, scope, requestKey);
  if (existing) {
    if (existing.requestFingerprint !== prepared.requestFingerprint) throw domainFailure("request_key_reused", "ai.attempt", null);
    return { kind: "existing", intent: existing };
  }
  const pricing: PricingVersion = requireDispatchPricing(input.pricing, runtime.now());
  const apiKey: string = runtime.readApiKey();
  const client: OpenAI = createAiClient(apiKey, runtime.fetch);
  let count: Readonly<{ inputTokens: number; requestId: string }>;
  try {
    const response = await client.responses.inputTokens.count(tokenCountPayload(prepared), { signal, maxRetries: 0 }).withResponse();
    if (!response.request_id) throw new Error("입력 토큰 집계 요청 식별자가 없습니다.");
    count = { inputTokens: response.data.input_tokens, requestId: response.request_id };
  } catch (error: unknown) { throw transportFailure(error, "token-count", owner, null); }
  const now: number = runtime.now();
  const bound: RequestBound = await calculateRequestBound(prepared, { requestFingerprint: prepared.requestFingerprint, model: aiSupportContract.model, inputTokens: count.inputTokens, providerRequestId: count.requestId, checkedAt: now }, pricing, now);
  const funding: FundingSnapshot = await runtime.checkFunding(owner, bound, now);
  const reserved = await reserveAiCost(runtime.db, { owner, requestKey, expectedVersion: input.windowVersion }, { id: crypto.randomUUID(), windowId: input.windowId, scope, now, prepared, bound, pricing, funding, ...(runtime.reservationGuards ? {reservationGuards:(requestId:string)=>runtime.reservationGuards!(owner,requestId)} : {}) });
  if (!reserved.created) return { kind: "existing", intent: reserved.intent };
  const call: AiCallRow = await beginAiDispatch(runtime.db, owner, { reservationId: reserved.intent.id, costScope: scope, costRequestKey: requestKey, logicalRequestKey: input.logicalRequestKey, attemptOrdinal: input.attemptOrdinal, now });
  await verifyRequestBound(prepared, bound, pricing);
  return { kind: "reserved", owner, call, intent: reserved.intent, bound, client };
}

/** 인증·자료 승인·가격 확인·자금 검사·D1 예약·전송 의도 저장 뒤에만 생성 API를 호출합니다. */
export async function executeAiAttempt(runtime: AttemptRuntime, input: AiAttemptInput, signal: AbortSignal): Promise<AiAttemptOutcome> {
  const prepared: PreparedAiRequest = await prepareAiRequest(input.request);
  const reserved = await reserveAiDispatch(runtime, input, prepared, signal);
  if (reserved.kind === "existing") return reserved;
  const { owner, call, bound, client } = reserved;
  if (prepared.body.stream !== false) throw new Error("비스트림 전송 본문이 필요합니다.");
  try {
    const received = await client.responses.create(prepared.body, { signal, maxRetries: 0, headers: { "X-Client-Request-Id": call.id } }).withResponse();
    return { kind: "received", owner, call, intent: reserved.intent, bound, raw: received.data, status: received.response.status, providerRequestId: received.request_id, parse: async (): Promise<LearningOutput> => learningOutput.parse(parseResponse(received.data, prepared.body).output_parsed) };
  } catch (error: unknown) {
    const failure: AiTransportFailure = transportFailure(error, "response", owner, call.id);
    await storeAiTransportEvidence(runtime.db, owner, call.id, failure.status, failure.providerRequestId);
    await preserveAiUnknown(runtime.db, owner, call.id, "ai_transport_failed", runtime.now());
    throw failure;
  }
}
