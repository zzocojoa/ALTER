import { policy, recordId } from "../domain/contracts.ts";
import type { Command, SiteIdentity } from "../domain/contracts.ts";
import { isDomainFailure } from "../../db/repositories/atomic.ts";
import { reserveAiCost, readAiCostIntent } from "../../db/repositories/ai-cost.ts";
import type { AiCostInput, AiCostReservation } from "../../db/repositories/ai-cost.ts";
import { beginAiDispatch } from "../../db/repositories/ai-call.ts";
import { preserveAiUnknown, settleAiUsage, storeAiEvidence } from "../../db/repositories/ai-settlement.ts";
import { readAiRequestStatus } from "../../db/repositories/ai-status.ts";
import { currentAiWindow } from "../../db/repositories/ai-window.ts";
import { seoulMonthWindow } from "../../db/repositories/usage.ts";
import { prepareAiRequest, calculateRequestBound } from "./request-bound.ts";
import type { ModelRequest } from "./request-bound.ts";
import { pricingVersion } from "./pricing.ts";
import type { PricingVersion } from "./pricing.ts";
import type { FundingSnapshot } from "./funding.ts";

export type AiLedgerAcceptance = Readonly<{ status: "passed"; environment: "local-workerd-d1" | "hosted-d1"; schema: "0009_ai_funding_integrity"; runId: string; startedAt: string; completedAt: string; checks: readonly string[]; providerEvidence: "synthetic-no-network"; paidCalls: 0; cleanup: "passed" }>;
type ReservationFixture = Readonly<{ context: Command; input: AiCostInput; logicalKey: string }>;
const cleanupTables = ["ai_calls", "ai_budget_blocks", "ai_funding_checks", "ai_cost_intents", "ai_pricing_versions", "external_attempts", "external_steps", "external_jobs", "cost_usage", "cost_reservations", "cost_windows", "atomic_checks", "atomic_requests", "backup_revisions"] as const;
const request: ModelRequest = { instructions: "검사 전용 합성 요청. 외부 전송 금지.", messages: [{ role: "user", content: [{ type: "input_text", text: "원장 검사" }] }], maximumOutputTokens: 64, reasoningEffort: "none" };
function ensure(condition: boolean, check: string): void { if (!condition) throw Object.assign(new Error(`AI 원장 검증 실패: ${check}`), { name: "AiLedgerAcceptanceFailure", check }); }
async function reject(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await action(); } catch (error: unknown) {
    const detail: string = isDomainFailure(error) ? error.code : error instanceof Error ? error.message : String(error);
    ensure(pattern.test(detail), `예상 오류 ${pattern.source}, 실제 ${detail}`); return;
  }
  throw new Error(`AI 원장 검증에서 거부되지 않은 요청: ${pattern.source}`);
}
/** 실제 가격·계정 잔액으로 사용하지 않는 검사 전용 합성 근거입니다. */
function syntheticPricing(now: number): PricingVersion {
  const provenance = { source: "https://example.invalid/alter-ledger-verification", checkedAt: now, validFrom: now, validUntil: now + 86_400_000, evidence: "fixture" } as const;
  const rates = { input: "0.10", cachedInput: "0.01", cacheWrite30m: "0.125", cacheWrite12h: "0.25", output: "0.50" } as const;
  return pricingVersion.parse({ id: crypto.randomUUID(), model: policy.model, currency: "USD", tokenPriceUnit: 1_000_000, pricing: { provenance, short: rates, long: rates, longContextThreshold: 272_000 }, exchange: { provenance, quote: "KRW/USD", krwPerUsd: "10000000" }, tax: { provenance, multiplier: "1" }, fee: { provenance, multiplier: "1" } });
}
function syntheticFunding(owner: SiteIdentity, pricing: PricingVersion, now: number): FundingSnapshot {
  ensure(owner.userId.startsWith("verification:"), "합성 잔액의 검사 전용 소유자");
  return { id: recordId.parse(crypto.randomUUID()), ownerId: owner.userId, accountFingerprint: "a".repeat(64), pricingVersionId: pricing.id, billingMode: "prepaid", creditAvailableUnits: 20_000_000_000, minimumTopupUnits: 5_000_000_000, reconciledReservationIds: [], payments: [], automaticRecharge: false, source: "https://example.invalid/alter-ledger-verification", checkedAt: now, validUntil: now + 86_400_000, evidence: "verified" };
}
async function fixture(db: D1Database, owner: SiteIdentity, pricing: PricingVersion, funding: FundingSnapshot, logicalKey: string, now: number): Promise<ReservationFixture> {
  const window = await currentAiWindow(db, owner, now);
  const prepared = await prepareAiRequest(request);
  const bound = await calculateRequestBound(prepared, { model: policy.model, requestFingerprint: prepared.requestFingerprint, inputTokens: 1000, providerRequestId: "synthetic-count-no-network", checkedAt: now }, pricing, now);
  return { logicalKey, context: { owner, requestKey: `${logicalKey}:1`, expectedVersion: window.version }, input: { id: crypto.randomUUID(), windowId: window.id, scope: "openai.response", now, prepared, bound, pricing, funding } };
}
async function dispatch(db: D1Database, item: ReservationFixture): Promise<void> {
  await beginAiDispatch(db, item.context.owner, { reservationId: item.input.id, costScope: item.input.scope, costRequestKey: item.context.requestKey, logicalRequestKey: item.logicalKey, attemptOrdinal: 1, now: item.input.now });
}
async function storeSyntheticUsage(db: D1Database, item: ReservationFixture, inputTokens: number): Promise<void> {
  await storeAiEvidence(db, item.context.owner, item.input.id, { providerRequestId: "synthetic-request-no-network", httpStatus: 200, facts: { responseId: `resp_verification_${item.input.id}`, model: policy.model, status: "completed", providerErrorCode: null, usage: { input_tokens: inputTokens, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 32, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: inputTokens + 32 } } });
}
async function cleanup(db: D1Database, owner: SiteIdentity, runId: string): Promise<void> {
  ensure(owner.userId === `verification:${runId}`, "정리 범위");
  await db.prepare("UPDATE verification_runs SET state='cleaning' WHERE owner_id=? AND id=?").bind(owner.userId, runId).run();
  await db.batch(cleanupTables.map((table): D1PreparedStatement => db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner.userId)));
  for (const table of cleanupTables) ensure(await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE owner_id=?`).bind(owner.userId).first<number>("n") === 0, `임시 데이터 정리 ${table}`);
  await db.prepare("DELETE FROM verification_runs WHERE owner_id=? AND id=?").bind(owner.userId, runId).run();
}

/** 서버 생성 소유자와 합성 시각·usage로만 검사하며 API 키·외부 네트워크·학습 기록에 접근하지 않습니다. */
export async function runAiLedgerAcceptance(db: D1Database, environment: AiLedgerAcceptance["environment"]): Promise<AiLedgerAcceptance> {
  const runId: string = crypto.randomUUID();
  const owner: SiteIdentity = { realm: "sites", userId: `verification:${runId}` };
  const startedAt: string = new Date().toISOString();
  const before: number = seoulMonthWindow(Date.now()).resetAt - 1;
  const after: number = before + 2;
  const pricing: PricingVersion = syntheticPricing(before);
  const funding: FundingSnapshot = syntheticFunding(owner, pricing, before);
  const checks: string[] = [];
  await db.prepare("INSERT INTO verification_runs VALUES (?,?,'running',?)").bind(owner.userId, runId, Date.now()).run();
  let failure: unknown = null;
  try {
    const base: ReservationFixture = await fixture(db, owner, pricing, funding, "race", before);
    await db.prepare("UPDATE cost_windows SET limit_units=? WHERE owner_id=? AND id=?").bind(base.input.bound.amount.units, owner.userId, base.input.windowId).run();
    const racers: ReservationFixture[] = [0, 1, 2, 3].map((index): ReservationFixture => ({ ...base, logicalKey: `race-${index}`, context: { ...base.context, requestKey: `race-${index}:1` }, input: { ...base.input, id: crypto.randomUUID() } }));
    const outcomes: PromiseSettledResult<AiCostReservation>[] = await Promise.allSettled(racers.map((item) => reserveAiCost(db, item.context, item.input)));
    ensure(outcomes.filter((item): boolean => item.status === "fulfilled").length === 1, "동시 예약 단일 성공");
    for (const outcome of outcomes) if (outcome.status === "rejected") ensure(isDomainFailure(outcome.reason) && outcome.reason.code === "version_conflict", "예약 경합 오류");
    const winner: ReservationFixture = racers[outcomes.findIndex((item): boolean => item.status === "fulfilled")];
    const one = await currentAiWindow(db, owner, before);
    ensure(one.reservedUnits === base.input.bound.amount.units && one.settledUnits === 0, "정확한 한도만 예약");
    ensure(!(await reserveAiCost(db, winner.context, winner.input)).created, "동일 키 재조회");
    ensure(await readAiCostIntent(db, { realm: "sites", userId: `other:${runId}` }, winner.input.scope, winner.context.requestKey) === null, "다른 소유자 격리");
    checks.push("concurrent-ai-reservation-exact-limit-idempotency-owner-isolation");
    const overflow: ReservationFixture = await fixture(db, owner, pricing, funding, "overflow", before);
    await reject(() => reserveAiCost(db, overflow.context, overflow.input), /limit_exceeded/);
    ensure(JSON.stringify(await currentAiWindow(db, owner, before)) === JSON.stringify(one), "초과 예약 전체 롤백");
    ensure(await readAiCostIntent(db, owner, overflow.input.scope, overflow.context.requestKey) === null, "실패한 예약 근거 없음");
    await reject(() => db.prepare("DELETE FROM ai_funding_checks WHERE owner_id=?").bind(owner.userId).run(), /immutable_ai_funding/);
    checks.push("failed-ai-reservation-full-rollback-and-immutable-funding");
    await dispatch(db, winner);
    await reject(() => dispatch(db, winner), /result_unknown/);
    await preserveAiUnknown(db, owner, winner.input.id, "synthetic_interrupted", before);
    const old = await readAiRequestStatus(db, owner, winner.logicalKey);
    ensure(old.length === 1 && old[0].reservationState === "unknown" && old[0].outstandingReservedUnits === one.reservedUnits && !old[0].automaticReplayAllowed, "중단 후 예약 보존·재전송 금지");
    checks.push("dispatch-once-and-interrupted-outcome-remains-reserved");
    const month = await currentAiWindow(db, owner, after);
    ensure(month.id !== one.id && month.periodStart === one.resetAt, "서울 월 경계");
    ensure((await currentAiWindow(db, owner, before)).reservedUnits === one.reservedUnits, "이전 달 미확정 예약 보존");
    checks.push("seoul-month-boundary-preserves-prior-unknown-reservation");
    const first: ReservationFixture = await fixture(db, owner, pricing, funding, "settle-first", after);
    await reserveAiCost(db, first.context, first.input); await dispatch(db, first); await storeSyntheticUsage(db, first, 1000);
    const second: ReservationFixture = await fixture(db, owner, pricing, funding, "settle-second", after);
    await reserveAiCost(db, second.context, second.input); await dispatch(db, second); await storeSyntheticUsage(db, second, 1000);
    const settlements = await Promise.all([first, second].map((item) => settleAiUsage(db, owner, item.input.id, after)));
    ensure(settlements.every((item): boolean => item.state === "settled" && item.actual !== null), "동시 정산 성공");
    const settled = await currentAiWindow(db, owner, after);
    ensure(settled.reservedUnits === 0 && settled.settledUnits === settlements.reduce((sum: number, item): number => { ensure(item.actual !== null, "사용량 비용"); return sum + item.actual!.units; }, 0), "동시 정산 합계");
    await Promise.all([0, 1].map(() => settleAiUsage(db, owner, first.input.id, after)));
    ensure(JSON.stringify(await currentAiWindow(db, owner, after)) === JSON.stringify(settled), "중복 정산 불변");
    ensure(await db.prepare("SELECT count(*) AS n FROM cost_usage WHERE owner_id=?").bind(owner.userId).first<number>("n") === 2, "사용량 중복 없음");
    checks.push("concurrent-distinct-ai-settlement-and-duplicate-settlement");
    const overrun: ReservationFixture = await fixture(db, owner, pricing, funding, "overrun", after);
    await reserveAiCost(db, overrun.context, overrun.input); await dispatch(db, overrun); await storeSyntheticUsage(db, overrun, 10000);
    const exceeded = await settleAiUsage(db, owner, overrun.input.id, after);
    ensure(exceeded.state === "overrun" && exceeded.actual !== null && exceeded.actual.units > overrun.input.bound.amount.units, "실제 초과액 보존");
    const blocked: ReservationFixture = await fixture(db, owner, pricing, funding, "blocked", after);
    await reject(() => reserveAiCost(db, blocked.context, blocked.input), /version_conflict/);
    ensure(await readAiCostIntent(db, owner, blocked.input.scope, blocked.context.requestKey) === null, "초과 이후 신규 요청 차단");
    checks.push("overrun-preserves-full-amount-and-blocks-new-ai-reservation");
  } catch (error: unknown) { failure = error; }
  try { await cleanup(db, owner, runId); }
  catch (cleanupError: unknown) { throw failure === null ? cleanupError : new AggregateError([failure, cleanupError], "AI 원장 검증과 임시 데이터 정리가 모두 실패했습니다."); }
  if (failure !== null) throw failure;
  return { status: "passed", environment, schema: "0009_ai_funding_integrity", runId, startedAt, completedAt: new Date().toISOString(), checks, providerEvidence: "synthetic-no-network", paidCalls: 0, cleanup: "passed" };
}
