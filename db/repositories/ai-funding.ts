import { usdReservationMicros } from "../../lib/ai/pricing.ts";
import { canonicalJson, domainFailure, policy } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { monthlyCommittedUnits, requireAiFunding, requireFundingSnapshot } from "../../lib/ai/funding.ts";
import type { FundingExposure, FundingSnapshot } from "../../lib/ai/funding.ts";
import type { RequestBound } from "../../lib/ai/request-bound.ts";
import { readStorage, requireInBatch } from "./atomic.ts";

const probeExposureSql: string = "SELECT coalesce(sum(json_extract(snapshot,'$.reservationUsdMicros')),0) AS reservedUsdMicros FROM ai_funding_checks WHERE owner_id=? AND json_type(snapshot,'$.prepaidProbe')='object'";
const exposureSql: string = "SELECT coalesce(sum(CASE WHEN w.category='ai' AND r.state IN ('reserved','unknown') THEN r.amount_units ELSE 0 END),0) AS aiReservedUnits,coalesce(sum(CASE WHEN w.category='ai' AND r.state='settled' AND r.id NOT IN (SELECT value FROM json_each(?)) THEN r.actual_units ELSE 0 END),0) AS aiUnreconciledSettledUnits,coalesce(sum(CASE WHEN w.category='operations' AND r.state IN ('reserved','unknown') THEN r.amount_units ELSE 0 END),0) AS operationsReservedUnits,coalesce(sum(CASE WHEN w.category='operations' AND r.state='settled' AND r.id NOT IN (SELECT value FROM json_each(?)) THEN r.actual_units ELSE 0 END),0) AS operationsUnreconciledSettledUnits FROM cost_reservations r JOIN cost_windows w ON w.owner_id=r.owner_id AND w.id=r.window_id WHERE r.owner_id=?";
export async function checkAiFunding(db: D1Database, owner: SiteIdentity, bound: RequestBound, snapshot: FundingSnapshot, now: number): Promise<FundingSnapshot> {
  const verified: FundingSnapshot = requireFundingSnapshot(snapshot, owner.userId, bound.amount.pricingVersionId, now);
  const ids: string = canonicalJson(verified.reconciledReservationIds);
  const exposure: FundingExposure | null = await readStorage("ai.funding", () => db.prepare(exposureSql).bind(ids, ids, owner.userId).first<FundingExposure>());
  if (!exposure) throw new Error("AI 자금 집계를 조회할 수 없습니다.");
  requireAiFunding(verified, exposure, bound.amount.units, now);
  if (!verified.prepaidProbe) return verified;
  const reservedUsdMicros: number = usdReservationMicros(bound.amount);
  const exposureUsd: number | null = await readStorage("ai.probe.usd", () => db.prepare(probeExposureSql).bind(owner.userId).first<number>("reservedUsdMicros"));
  if (exposureUsd === null || exposureUsd + reservedUsdMicros > verified.prepaidProbe.limitUsdMicros) throw domainFailure("limit_exceeded", "ai.probe.cumulative-cap", null);
  return { ...verified, reservationUsdMicros: reservedUsdMicros };
}
/** 사전 검사 뒤 동시 호출이 들어와도 예약 INSERT와 같은 배치에서 잔액·추가 예산을 다시 검사합니다. */
export function fundingReservationCheck(db: D1Database, owner: SiteIdentity, snapshot: FundingSnapshot, amountUnits: number, now: number, requestId: string): D1PreparedStatement {
  const ids: string = canonicalJson(snapshot.reconciledReservationIds);
  return requireInBatch(db, owner.userId, requestId, 2, `EXISTS(SELECT 1 FROM (${exposureSql}) WHERE (?='postpaid' OR aiReservedUnits+aiUnreconciledSettledUnits+?<=?) AND ?+operationsReservedUnits+operationsUnreconciledSettledUnits+CASE WHEN ?='postpaid' THEN aiReservedUnits+aiUnreconciledSettledUnits+? ELSE 0 END<=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) paid WHERE NOT EXISTS(SELECT 1 FROM cost_usage u WHERE u.owner_id=? AND u.reservation_id=paid.value))`, [ids, ids, owner.userId, snapshot.billingMode, amountUnits, snapshot.creditAvailableUnits, monthlyCommittedUnits(snapshot, now), snapshot.billingMode, amountUnits, policy.operationsMonthlyKrw * policy.moneyScale, ids, owner.userId]);
}
/** 완료·실패·월 변경·설정 ID 변경에도 반환하지 않고 전체 시도 상한을 같은 D1 배치에서 누적합니다. */
export function probeReservationChecks(db: D1Database, owner: SiteIdentity, snapshot: FundingSnapshot, bound: RequestBound, requestId: string): readonly D1PreparedStatement[] {
  if (!snapshot.prepaidProbe) return [];
  const required: number = usdReservationMicros(bound.amount);
  if (snapshot.reservationUsdMicros !== required) throw domainFailure("validation", "ai.probe.usd-reservation", null);
  return [...coffeeReservationChecks(db, owner, snapshot, bound, requestId), requireInBatch(db, owner.userId, requestId, 3, `EXISTS(SELECT 1 FROM (${probeExposureSql}) WHERE reservedUsdMicros+?<=? AND reservedUsdMicros+?<=?)`, [owner.userId, required, snapshot.prepaidProbe.limitUsdMicros, required, snapshot.prepaidProbe.creditAvailableUsdMicros])];
}
export function fundingSnapshotStatement(db: D1Database, owner: SiteIdentity, snapshot: FundingSnapshot, now: number, reservationId: string): D1PreparedStatement {
  return db.prepare("INSERT INTO ai_funding_checks (owner_id,reservation_id,snapshot,checked_at) VALUES (?,?,?,?)").bind(owner.userId, reservationId, canonicalJson(snapshot), now);
}

/** 완료·실패·동시 요청에도 품질 재검증을 포함한 총 31단계와 한 단원 제한을 동일 예약 배치에서 검사합니다. */
function coffeeReservationChecks(db: D1Database, owner: SiteIdentity, snapshot: FundingSnapshot, bound: RequestBound, requestId: string): readonly D1PreparedStatement[] {
  const coffee = snapshot.coffeeProbe;
  if (!coffee) return [];
  if (snapshot.prepaidProbe?.limitUsdMicros !== 300000 || bound.inputTokenBound > 10000 || bound.requestFingerprint !== coffee.requestFingerprint) throw domainFailure("validation", "coffee.reservation-binding", null);
  const scope = "owner_id=? AND json_extract(snapshot,'$.coffeeProbe.approvalId')=?";
  return [requireInBatch(db, owner.userId, requestId, 4, `
    (SELECT count(DISTINCT json_extract(snapshot,'$.coffeeProbe.logicalRequestKey')) FROM ai_funding_checks WHERE ${scope} AND json_extract(snapshot,'$.coffeeProbe.logicalRequestKey')<>?)<31
    AND (SELECT count(DISTINCT json_extract(snapshot,'$.coffeeProbe.logicalRequestKey')) FROM ai_funding_checks WHERE ${scope} AND json_extract(snapshot,'$.coffeeProbe.logicalRequestKey')<>? AND (json_extract(snapshot,'$.coffeeProbe.kind')='page-vision')=(?='page-vision'))<?
    AND (SELECT count(*) FROM ai_funding_checks WHERE ${scope} AND json_extract(snapshot,'$.coffeeProbe.logicalRequestKey')=?)<3
    AND NOT EXISTS(SELECT 1 FROM ai_funding_checks WHERE ${scope} AND json_extract(snapshot,'$.coffeeProbe.logicalRequestKey')=? AND json_extract(snapshot,'$.coffeeProbe.requestFingerprint')<>?)
    AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM ai_funding_checks WHERE ${scope} AND json_extract(snapshot,'$.coffeeProbe.unitId') IS NOT NULL AND json_extract(snapshot,'$.coffeeProbe.unitId')<>?))`,
    [owner.userId, coffee.approvalId, coffee.logicalRequestKey, owner.userId, coffee.approvalId, coffee.logicalRequestKey, coffee.kind, coffee.kind === "page-vision" ? 10 : 21, owner.userId, coffee.approvalId, coffee.logicalRequestKey, owner.userId, coffee.approvalId, coffee.logicalRequestKey, coffee.requestFingerprint, coffee.unitId, owner.userId, coffee.approvalId, coffee.unitId])];
}
