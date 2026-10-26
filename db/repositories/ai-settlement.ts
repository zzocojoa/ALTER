import { z } from "zod";
import { canonicalJson, domainFailure, recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { calculateUsageCost, pricingVersion } from "../../lib/ai/pricing.ts";
import type { PricedMoney } from "../../lib/ai/pricing.ts";
import { normalizeAiUsage } from "../../lib/ai/usage.ts";
import { aiSupportContract } from "../../lib/ai/support.ts";
import type { ResponseFacts } from "../../lib/ai/response.ts";
import type { LearningOutput } from "../../lib/ai/learning-contract.ts";
import { readAiCall } from "./ai-call.ts";
import type { AiCallRow } from "./ai-call.ts";
import { executeAtomic, guardedUpdate, isDomainFailure, readStorage } from "./atomic.ts";
import { costSettlementStatements } from "./usage.ts";
import { confirmExternalStep, markExternalUnknown } from "./external.ts";

type CostState = Readonly<{ version: number; state: "reserved" | "unknown" | "settled" | "released"; amountUnits: number; actualUnits: number | null; windowId: string; windowVersion: number; snapshot: string; createdAt: number }>;
export type AiEvidence = Readonly<{ facts: ResponseFacts; providerRequestId: string | null; httpStatus: number }>;
export type AiSettlement = Readonly<{ state: "settled" | "unknown" | "overrun"; actual: PricedMoney | null; call: AiCallRow }>;

async function requiredCall(db: D1Database, owner: SiteIdentity, callId: string): Promise<AiCallRow> {
  const call: AiCallRow | null = await readAiCall(db, owner, callId);
  if (!call) throw domainFailure("reference_conflict", "ai.settlement.call", null);
  return call;
}
async function costState(db: D1Database, owner: SiteIdentity, callId: string): Promise<CostState> {
  const value: CostState | null = await readStorage("ai.settlement.cost", () => db.prepare("SELECT r.version,r.state,r.amount_units AS amountUnits,r.actual_units AS actualUnits,r.window_id AS windowId,w.version AS windowVersion,p.snapshot,i.created_at AS createdAt FROM cost_reservations r JOIN cost_windows w ON w.owner_id=r.owner_id AND w.id=r.window_id JOIN ai_cost_intents i ON i.owner_id=r.owner_id AND i.id=r.id JOIN ai_pricing_versions p ON p.owner_id=i.owner_id AND p.id=i.pricing_version_id WHERE r.owner_id=? AND r.id=?").bind(owner.userId, callId).first<CostState>());
  if (!value) throw domainFailure("reference_conflict", "ai.settlement.cost", null);
  return value;
}

/** 동시 상태 갱신의 CAS 충돌만 최신 상태를 다시 읽어 재시도합니다. 외부 생성은 하지 않습니다. */
async function reconcile<T>(operation: string, run: () => Promise<T>): Promise<T> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try { return await run(); }
    catch (error: unknown) {
      if (!isDomainFailure(error) || error.code !== "version_conflict" || attempt === 3) throw error;
      console.warn({ event: "ai_state_cas_retry", operation, attempt });
    }
  }
  throw domainFailure("result_unknown", operation, null);
}

/** 원문 대신 비용 사실을 먼저 저장하여 파싱 예외나 정산 실패 뒤에도 복구할 수 있게 합니다. */
export async function storeAiEvidence(db: D1Database, owner: SiteIdentity, callId: string, evidence: AiEvidence): Promise<AiCallRow> {
  siteIdentity.parse(owner); recordId.parse(callId); z.number().int().min(100).max(599).parse(evidence.httpStatus);
  const encoded: string = canonicalJson(evidence.facts);
  if (new TextEncoder().encode(encoded).byteLength > 65_536) throw domainFailure("validation", "ai.evidence.size", null);
  return reconcile("ai.evidence", async (): Promise<AiCallRow> => {
    const call: AiCallRow = await requiredCall(db, owner, callId);
    if (call.responseId && evidence.facts.responseId !== call.responseId) throw domainFailure("reference_conflict", "ai.evidence.response-id", null);
    if (call.usage === encoded) return call;
    if (["settled", "validated", "invalid"].includes(call.stage)) throw domainFailure("reference_conflict", "ai.evidence.settled", null);
    if (call.usage && (JSON.parse(call.usage) as ResponseFacts).usage !== null) throw domainFailure("reference_conflict", "ai.evidence.usage-changed", null);
    await executeAtomic(db, { owner, requestKey: crypto.randomUUID(), expectedVersion: call.version }, "ai.evidence", evidence, callId, call.version + 1, (requestId: string) => guardedUpdate(db, "ai_calls", owner.userId, callId, call.version, requestId, 0, "stage=?,response_id=?,provider_request_id=?,usage=?,http_status=?", [evidence.facts.usage === null ? "response-received" : "usage-stored", evidence.facts.responseId, evidence.providerRequestId, encoded, evidence.httpStatus], "stage NOT IN ('settled','validated','invalid')", []));
    return requiredCall(db, owner, callId);
  });
}

async function synchronizeExternal(db: D1Database, owner: SiteIdentity, call: AiCallRow, now: number): Promise<void> {
  await reconcile("ai.external", async (): Promise<void> => {
    const step: Readonly<{ version: number; state: string }> | null = await readStorage("ai.external.step", () => db.prepare("SELECT version,state FROM external_steps WHERE owner_id=? AND id=?").bind(owner.userId, call.stepId).first());
    if (!step) throw domainFailure("reference_conflict", "ai.external.step", null);
    const context: Command = { owner, requestKey: crypto.randomUUID(), expectedVersion: step.version };
    if (["settled", "validated", "invalid"].includes(call.stage)) {
      if (step.state === "confirmed") return;
      await confirmExternalStep(db, context, { stepId: recordId.parse(call.stepId), externalId: call.responseId ?? `local-call:${call.id}`, businessKey: `${call.logicalRequestKey}:${call.attemptOrdinal}`, evidence: "usage-calculated;not-provider-invoice", checkedAt: now });
    } else if (call.stage === "unknown" && step.state === "leased") {
      await markExternalUnknown(db, context, call.stepId, call.failureCode ?? "ai_outcome_unknown");
    }
  });
}

/** 미과금 증거가 없으므로 사용량 유실·취소·전송 실패는 예약액을 그대로 유지합니다. */
export async function preserveAiUnknown(db: D1Database, owner: SiteIdentity, callId: string, failureCode: string, now: number): Promise<AiCallRow> {
  siteIdentity.parse(owner); recordId.parse(callId); timestamp.parse(now); z.string().regex(/^[a-z_]{1,100}$/).parse(failureCode);
  const result: AiCallRow = await reconcile("ai.unknown", async (): Promise<AiCallRow> => {
    const call: AiCallRow = await requiredCall(db, owner, callId);
    const cost: CostState = await costState(db, owner, callId);
    if (cost.state === "settled" || call.stage === "unknown") return call;
    const context: Command = { owner, requestKey: crypto.randomUUID(), expectedVersion: call.version };
    await executeAtomic(db, context, "ai.unknown", { callId, failureCode }, callId, call.version + 1, (requestId: string) => [
      ...guardedUpdate(db, "cost_reservations", owner.userId, callId, cost.version, requestId, 0, "state='unknown'", [], "state IN ('reserved','unknown')", []),
      ...guardedUpdate(db, "ai_calls", owner.userId, callId, call.version, requestId, 1, "stage='unknown',failure_code=?", [failureCode], "stage NOT IN ('settled','validated','invalid')", []),
    ]);
    return requiredCall(db, owner, callId);
  });
  await synchronizeExternal(db, owner, result, now);
  return result;
}

/** 저장된 가격·usage로 계산하며 상한 초과액은 축소하지 않고 영구 차단 근거로 보존합니다. */
export async function settleAiUsage(db: D1Database, owner: SiteIdentity, callId: string, now: number): Promise<AiSettlement> {
  siteIdentity.parse(owner); recordId.parse(callId); timestamp.parse(now);
  const result: AiSettlement = await reconcile("ai.settle", async (): Promise<AiSettlement> => {
    const call: AiCallRow = await requiredCall(db, owner, callId);
    const cost: CostState = await costState(db, owner, callId);
    const facts: ResponseFacts | null = call.usage === null ? null : JSON.parse(call.usage) as ResponseFacts;
    if (!facts?.usage || facts.model !== aiSupportContract.model) return { state: "unknown", actual: null, call: await preserveAiUnknown(db, owner, callId, "ai_usage_unavailable", now) };
    let actual: PricedMoney;
    try { actual = calculateUsageCost(normalizeAiUsage(facts.usage), pricingVersion.parse(JSON.parse(cost.snapshot)), cost.createdAt); }
    catch (error: unknown) {
      await preserveAiUnknown(db, owner, callId, "ai_usage_invalid", now);
      throw error;
    }
    if (cost.state === "settled") {
      if (cost.actualUnits !== actual.units) throw domainFailure("reference_conflict", "ai.settle.actual-changed", null);
      return { state: "settled", actual, call };
    }
    if (actual.units > cost.amountUnits) {
      const exists: number | null = await readStorage("ai.overrun.read", () => db.prepare("SELECT actual_units FROM ai_budget_blocks WHERE owner_id=? AND reservation_id=?").bind(owner.userId, callId).first<number>("actual_units"));
      if (exists !== null) {
        if (exists !== actual.units) throw domainFailure("reference_conflict", "ai.overrun.changed", null);
        return { state: "overrun", actual, call };
      }
      await executeAtomic(db, { owner, requestKey: crypto.randomUUID(), expectedVersion: call.version }, "ai.overrun", { callId, actual }, callId, call.version + 1, (requestId: string) => [
        db.prepare("INSERT INTO ai_budget_blocks VALUES (?,?,?,?,?,?)").bind(owner.userId, crypto.randomUUID(), callId, "reservation-bound-exceeded", actual.units, now),
        ...guardedUpdate(db, "cost_reservations", owner.userId, callId, cost.version, requestId, 0, "state='unknown'", [], "state IN ('reserved','unknown')", []),
        ...guardedUpdate(db, "ai_calls", owner.userId, callId, call.version, requestId, 1, "stage='unknown',failure_code='ai_cost_overrun'", [], "stage NOT IN ('settled','validated','invalid')", []),
      ]);
      return { state: "overrun", actual, call: await requiredCall(db, owner, callId) };
    }
    const context: Command = { owner, requestKey: crypto.randomUUID(), expectedVersion: cost.version };
    await executeAtomic(db, context, "ai.settle", { callId, actual }, callId, cost.version + 1, (requestId: string) => [
      ...costSettlementStatements(db, context, { reservationId: recordId.parse(callId), windowId: recordId.parse(cost.windowId), windowVersion: cost.windowVersion, actualUnits: actual.units, providerReceipt: facts.responseId ? `response:${facts.responseId}` : call.providerRequestId ? `request:${call.providerRequestId}` : `local-call:${callId}`, occurredAt: cost.createdAt }, requestId),
      ...guardedUpdate(db, "ai_calls", owner.userId, callId, call.version, requestId, 2, "stage='settled',failure_code=NULL", [], "usage IS NOT NULL AND stage IN ('usage-stored','unknown')", []),
    ]);
    return { state: "settled", actual, call: await requiredCall(db, owner, callId) };
  });
  await synchronizeExternal(db, owner, result.call, now);
  return result;
}

/** 학습 확정 테이블에는 쓰지 않고 검증된 제안만 AI 요청 상태에 보존합니다. */
export async function storeAiValidated(db: D1Database, owner: SiteIdentity, callId: string, output: LearningOutput): Promise<void> {
  const call: AiCallRow = await requiredCall(db, owner, callId);
  const encoded: string = canonicalJson(output);
  if (call.stage === "validated" && call.result === encoded) return;
  await executeAtomic(db, { owner, requestKey: crypto.randomUUID(), expectedVersion: call.version }, "ai.validated", { callId, output }, callId, call.version + 1, (requestId: string) => guardedUpdate(db, "ai_calls", owner.userId, callId, call.version, requestId, 0, "stage='validated',result=?", [encoded], "stage='settled'", []));
}
export async function storeAiInvalid(db: D1Database, owner: SiteIdentity, callId: string, code: string): Promise<void> {
  z.string().regex(/^[a-z_]{1,100}$/).parse(code);
  const call: AiCallRow = await requiredCall(db, owner, callId);
  if (call.stage === "invalid" && call.failureCode === code) return;
  await executeAtomic(db, { owner, requestKey: crypto.randomUUID(), expectedVersion: call.version }, "ai.invalid", { callId, code }, callId, call.version + 1, (requestId: string) => guardedUpdate(db, "ai_calls", owner.userId, callId, call.version, requestId, 0, "stage='invalid',failure_code=?", [code], "stage='settled'", []));
}

/** 전송 오류의 안전한 식별 정보만 보존하고 본문·키·원문 메시지는 저장하지 않습니다. */
export async function storeAiTransportEvidence(db: D1Database, owner: SiteIdentity, callId: string, status: number | null, providerRequestId: string | null): Promise<void> {
  z.number().int().min(100).max(599).nullable().parse(status); z.string().min(1).max(200).nullable().parse(providerRequestId);
  const call: AiCallRow = await requiredCall(db, owner, callId);
  await executeAtomic(db, { owner, requestKey: crypto.randomUUID(), expectedVersion: call.version }, "ai.transport.evidence", { callId, status, providerRequestId }, callId, call.version + 1, (requestId: string) => guardedUpdate(db, "ai_calls", owner.userId, callId, call.version, requestId, 0, "http_status=?,provider_request_id=?", [status, providerRequestId], "stage IN ('intent','response-received','unknown')", []));
}
