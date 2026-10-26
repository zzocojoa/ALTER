import { requireCurrentExecutionAuthority } from "./restore-execution.ts";
import { z } from "zod";
import { domainFailure, recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { enqueueExternalJob, claimExternalStep } from "./external.ts";
import { executeAtomic, readStorage } from "./atomic.ts";
import { readAiCostIntent } from "./ai-cost.ts";

export type AiCallRow = Readonly<{ id: string; version: number; stepId: string; logicalRequestKey: string; attemptOrdinal: number; stage: "intent" | "response-received" | "usage-stored" | "settled" | "validated" | "invalid" | "unknown"; responseId: string | null; providerRequestId: string | null; usage: string | null; result: string | null; failureCode: string | null; httpStatus: number | null }>;
export type DispatchInput = Readonly<{ reservationId: string; costScope: string; costRequestKey: string; logicalRequestKey: string; attemptOrdinal: number; now: number }>;

export async function readAiCall(db: D1Database, owner: SiteIdentity, id: string): Promise<AiCallRow | null> {
  siteIdentity.parse(owner); recordId.parse(id);
  return readStorage("ai.call.read", () => db.prepare("SELECT id,version,step_id AS stepId,logical_request_key AS logicalRequestKey,attempt_ordinal AS attemptOrdinal,stage,response_id AS responseId,provider_request_id AS providerRequestId,usage,result,failure_code AS failureCode,http_status AS httpStatus FROM ai_calls WHERE owner_id = ? AND id = ?").bind(owner.userId, id).first<AiCallRow>());
}

/** 새 전송 의도 INSERT에 성공한 실행만 전송할 수 있고 재조회·리스 만료는 재전송 근거가 아닙니다. */
export async function beginAiDispatch(db: D1Database, owner: SiteIdentity, input: DispatchInput): Promise<AiCallRow> {
  await requireCurrentExecutionAuthority(db, owner);
  siteIdentity.parse(owner); recordId.parse(input.reservationId); timestamp.parse(input.now);
  z.string().min(1).max(180).parse(input.logicalRequestKey); z.number().int().min(1).max(3).parse(input.attemptOrdinal);
  const intent = await readAiCostIntent(db, owner, input.costScope, input.costRequestKey);
  if (!intent || intent.id !== input.reservationId || intent.state !== "reserved") throw domainFailure("reference_conflict", "ai.call.reservation-required", null);
  if (await readAiCall(db, owner, input.reservationId)) throw domainFailure("result_unknown", "ai.call.already-dispatched", null);
  const stepId = recordId.parse(crypto.randomUUID());
  const callId = recordId.parse(input.reservationId);
  const businessKey: string = `${input.logicalRequestKey}:${input.attemptOrdinal}`;
  const context: Command = { owner, requestKey: `ai-enqueue:${callId}`, expectedVersion: 1 };
  await enqueueExternalJob(db, context, { id: callId, weeklyVersionId: null, businessKey, kind: "ai", steps: [{ id: stepId, kind: "openai-responses" }] });
  await claimExternalStep(db, { ...context, requestKey: `ai-claim:${callId}` }, { stepId, attemptId: callId, ordinal: 1, now: input.now, leaseUntil: input.now + 120_000 });
  await executeAtomic(db, { owner, requestKey: crypto.randomUUID(), expectedVersion: 1 }, "ai.dispatch.once", { callId, stepId }, callId, 1, (requestId: string) => [
    db.prepare("INSERT INTO ai_calls (owner_id,id,version,last_request_id,step_id,logical_request_key,attempt_ordinal,stage) VALUES (?,?,1,?,?,?,?,'intent')").bind(owner.userId, callId, requestId, stepId, input.logicalRequestKey, input.attemptOrdinal),
  ]);
  const stored: AiCallRow | null = await readAiCall(db, owner, callId);
  if (!stored) throw domainFailure("result_unknown", "ai.call.dispatch-state", null);
  return stored;
}
