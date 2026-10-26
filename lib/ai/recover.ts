import { requireCurrentExecutionAuthority } from "../../db/repositories/restore-execution.ts";
import OpenAI from "openai";
import { requireAiOutputLimit } from "./response.ts";
import { parseResponse } from "openai/lib/ResponsesParser";
import type { Response as ModelResponse } from "openai/resources/responses/responses";
import { readAiCall } from "../../db/repositories/ai-call.ts";
import { readAiIntentForCall } from "../../db/repositories/ai-status.ts";
import { readAiCostIntent } from "../../db/repositories/ai-cost.ts";
import { completeAiDelivery } from "./complete.ts";
import type { CompletionRuntime } from "./complete.ts";
import { createAiClient } from "./client.ts";
import type { ModelFetch } from "./client.ts";
import { formatForKind, learningOutput } from "./learning-contract.ts";
import type { LearningKind, LearningOutput } from "./learning-contract.ts";
import type { RequestBound } from "./request-bound.ts";
import { aiSupportContract } from "./support.ts";
import { domainFailure } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";

export type AiRecoveryRuntime = CompletionRuntime & Readonly<{ authenticate: () => Promise<SiteIdentity>; readApiKey: () => string; fetch: ModelFetch }>;
async function retrieveExisting(client: OpenAI, responseId: string, signal: AbortSignal): Promise<Readonly<{ data: ModelResponse; status: number; requestId: string | null }>> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try {
      const received = await client.responses.retrieve(responseId, { stream: false }, { signal, maxRetries: 0 }).withResponse();
      return { data: received.data, status: received.response.status, requestId: received.request_id };
    } catch (error: unknown) {
      const transient: boolean = error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.APIError && error.status !== undefined && error.status >= 500;
      if (!transient || attempt === 3 || signal.aborted) throw domainFailure("result_unknown", "ai.recover.lookup", error);
      console.warn({ event: "ai_recovery_read_retry", responseId, attempt, status: error instanceof OpenAI.APIError ? error.status : null });
    }
  }
  throw domainFailure("result_unknown", "ai.recover.lookup", null);
}

/** 소유자에게 이미 저장된 응답 ID만 조회하며 ID가 없거나 조회 실패하면 생성하지 않습니다. */
export async function recoverAiResponse(runtime: AiRecoveryRuntime, callId: string, expectedKind: LearningKind, signal: AbortSignal): Promise<LearningOutput> {
  const owner: SiteIdentity = await runtime.authenticate();
  await requireCurrentExecutionAuthority(runtime.db, owner);
  const call = await readAiCall(runtime.db, owner, callId);
  if (!call) throw domainFailure("reference_conflict", "ai.recover.call", null);
  if (call.stage === "validated" && call.result) return learningOutput.parse(JSON.parse(call.result));
  if (!call.responseId) throw domainFailure("result_unknown", "ai.recover.no-response-id", null);
  const reference = await readAiIntentForCall(runtime.db, owner, callId);
  if (!reference) throw domainFailure("reference_conflict", "ai.recover.intent", null);
  const intent = await readAiCostIntent(runtime.db, owner, reference.scope, reference.requestKey);
  if (!intent) throw domainFailure("reference_conflict", "ai.recover.reservation", null);
  const received = await retrieveExisting(createAiClient(runtime.readApiKey(), runtime.fetch), call.responseId, signal);
  const bound: RequestBound = JSON.parse(intent.bound) as RequestBound;
  return completeAiDelivery(runtime, { kind: "received", owner, call, intent, bound, raw: received.data, status: received.status, providerRequestId: received.requestId, parse: async (): Promise<LearningOutput> => { requireAiOutputLimit(received.data, bound.outputTokenBound); return learningOutput.parse(parseResponse(received.data, { model: aiSupportContract.model, text: { format: formatForKind(expectedKind) }, tools: [] }).output_parsed); } }, expectedKind);
}
