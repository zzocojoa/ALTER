import { requireCurrentExecutionAuthority } from "./restore-execution.ts";
import { requireFundingSnapshot } from "../../lib/ai/funding.ts";
import type { FundingSnapshot } from "../../lib/ai/funding.ts";
import { fundingReservationCheck, fundingSnapshotStatement, probeReservationChecks } from "./ai-funding.ts";
import { z } from "zod";
import { canonicalJson, domainFailure, policy, recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { pricingFingerprint, pricingVersion, requirePricingAt } from "../../lib/ai/pricing.ts";
import type { PricingVersion } from "../../lib/ai/pricing.ts";
import { verifyRequestBound } from "../../lib/ai/request-bound.ts";
import type { PreparedAiRequest, RequestBound } from "../../lib/ai/request-bound.ts";
import { executeAtomic, guardedUpdate, isDomainFailure, readStorage, requireInBatch } from "./atomic.ts";

export type AiCostIntent = Readonly<{ id: string; windowId: string; requestFingerprint: string; bound: string; state: "reserved" | "settled" | "released" | "unknown"; amountUnits: number; version: number }>;
export type AiCostReservation = Readonly<{ created: boolean; intent: AiCostIntent }>;
export type AiCostInput = Readonly<{ id: string; windowId: string; scope: string; now: number; prepared: PreparedAiRequest; bound: RequestBound; pricing: PricingVersion; funding: FundingSnapshot; reservationGuards?: (requestId:string)=>readonly D1PreparedStatement[] }>;

export async function readAiCostIntent(db: D1Database, owner: SiteIdentity, scope: string, requestKey: string): Promise<AiCostIntent | null> {
  siteIdentity.parse(owner); z.string().min(1).max(200).parse(scope); z.string().min(1).max(200).parse(requestKey);
  return readStorage("ai.cost.read", () => db.prepare("SELECT i.id,r.window_id AS windowId,i.request_fingerprint AS requestFingerprint,i.bound,r.state,r.amount_units AS amountUnits,r.version FROM ai_cost_intents i JOIN cost_reservations r ON r.owner_id = i.owner_id AND r.id = i.id WHERE i.owner_id = ? AND i.scope = ? AND i.request_key = ?").bind(owner.userId, scope, requestKey).first<AiCostIntent>());
}

function replayIntent(intent: AiCostIntent, fingerprint: string): AiCostReservation {
  if (intent.requestFingerprint !== fingerprint) throw domainFailure("request_key_reused", "ai.cost.reserve", null);
  return { created: false, intent };
}

/** 예약·가격 스냅샷·요청 지문은 한 배치에 넣고, 기존 요청의 재조회는 전송 권한을 주지 않습니다. */
export async function reserveAiCost(db: D1Database, context: Command, input: AiCostInput): Promise<AiCostReservation> {
  await requireCurrentExecutionAuthority(db, context.owner);
  recordId.parse(input.id); recordId.parse(input.windowId); timestamp.parse(input.now);
  z.string().min(1).max(200).parse(input.scope);
  await verifyRequestBound(input.prepared, input.bound, input.pricing);
  const previous: AiCostIntent | null = await readAiCostIntent(db, context.owner, input.scope, context.requestKey);
  if (previous !== null) return replayIntent(previous, input.prepared.requestFingerprint);
  if (input.bound.computedAt > input.now || input.now - input.bound.computedAt > 300_000) throw domainFailure("validation", "ai.cost.expired-bound", null);
  const pricing: PricingVersion = requirePricingAt(pricingVersion.parse(input.pricing), input.now);
  const fingerprint: string = await pricingFingerprint(pricing);
  const funding: FundingSnapshot = requireFundingSnapshot(input.funding, context.owner.userId, pricing.id, input.now);
  if (Boolean(pricing.purpose) !== Boolean(funding.prepaidProbe)) throw domainFailure("validation", "ai.probe.funding-purpose", null);
  try {
    await executeAtomic(db, context, `ai.cost.reserve:${input.scope}`, { reservationId: input.id, windowId: input.windowId, bound: input.bound }, input.id, 1, (requestId: string) => [
      ...(input.reservationGuards ? input.reservationGuards(requestId) : []),
      db.prepare("INSERT INTO ai_pricing_versions (owner_id,id,fingerprint,snapshot,created_at) VALUES (?,?,?,?,?) ON CONFLICT(owner_id,id) DO NOTHING").bind(context.owner.userId, pricing.id, fingerprint, canonicalJson(pricing), input.now),
      requireInBatch(db, context.owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM ai_pricing_versions WHERE owner_id = ? AND id = ? AND fingerprint = ?) AND NOT EXISTS(SELECT 1 FROM ai_budget_blocks WHERE owner_id = ?)", [context.owner.userId, pricing.id, fingerprint, context.owner.userId]),
      fundingReservationCheck(db, context.owner, funding, input.bound.amount.units, input.now, requestId),
      ...probeReservationChecks(db, context.owner, funding, input.bound, requestId),
      ...guardedUpdate(db, "cost_windows", context.owner.userId, input.windowId, context.expectedVersion, requestId, 1, "reserved_units = reserved_units + ?", [input.bound.amount.units], "category = 'ai' AND period_start <= ? AND reset_at > ?", [input.now, input.now]),
      db.prepare("INSERT INTO cost_reservations VALUES (?,?,1,?,?,?,?,?,'reserved',NULL)").bind(context.owner.userId, input.id, requestId, input.windowId, `${input.scope}:${context.requestKey}`, policy.model, input.bound.amount.units),
      fundingSnapshotStatement(db, context.owner, funding, input.now, input.id),
      db.prepare("INSERT INTO ai_cost_intents (owner_id,id,scope,request_key,request_fingerprint,pricing_version_id,bound,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.scope, context.requestKey, input.prepared.requestFingerprint, pricing.id, canonicalJson(input.bound), input.now),
    ]);
  } catch (error: unknown) {
    if (!isDomainFailure(error)) throw error;
    const raced: AiCostIntent | null = await readAiCostIntent(db, context.owner, input.scope, context.requestKey);
    if (raced !== null) return replayIntent(raced, input.prepared.requestFingerprint);
    throw error;
  }
  const stored: AiCostIntent | null = await readAiCostIntent(db, context.owner, input.scope, context.requestKey);
  if (stored === null) throw domainFailure("result_unknown", "ai.cost.reserve", null);
  return { created: true, intent: stored };
}
