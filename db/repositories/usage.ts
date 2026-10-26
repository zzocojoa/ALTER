import { z } from "zod";
import { policy, recordId, timestamp, version } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const costWindowInput = z.object({ id: recordId, category: z.enum(["ai", "operations"]), periodStart: timestamp, resetAt: timestamp }).strict().refine((value) => value.periodStart < value.resetAt);
const costReservationInput = z.object({ id: recordId, windowId: recordId, businessKey: z.string().min(1), model: z.enum(["gpt-6-luna", "operations"]), amountUnits: units, now: timestamp }).strict();
const settlementInput = z.object({ reservationId: recordId, windowId: recordId, windowVersion: version, actualUnits: units, providerReceipt: z.string().min(1), occurredAt: timestamp }).strict();
const quotaWindowInput = z.object({ id: recordId, api: z.string().min(1), projectKey: z.string().min(1), providerUser: z.string().min(1), quotaUnit: z.string().min(1), periodStart: timestamp, resetAt: timestamp, limitUnits: units }).strict().refine((value) => value.periodStart < value.resetAt);
const quotaReservationInput = z.object({ id: recordId, windowId: recordId, businessKey: z.string().min(1), method: z.string().min(1), weight: units.refine((value) => value > 0), now: timestamp }).strict();
export type CostWindowInput = z.infer<typeof costWindowInput>;
export type CostReservationInput = z.infer<typeof costReservationInput>;
export type SettlementInput = z.infer<typeof settlementInput>;
export type QuotaWindowInput = z.infer<typeof quotaWindowInput>;
export type QuotaReservationInput = z.infer<typeof quotaReservationInput>;

export function seoulMonthWindow(now: number): Readonly<{ periodStart: number; resetAt: number }> {
  timestamp.parse(now);
  const shifted: Date = new Date(now + 9 * 60 * 60 * 1000);
  return { periodStart: Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - 9 * 60 * 60 * 1000, resetAt: Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) - 9 * 60 * 60 * 1000 };
}
export async function createCostWindow(db: D1Database, context: Command, value: CostWindowInput): Promise<Receipt> {
  const input: CostWindowInput = costWindowInput.parse(value);
  const window = seoulMonthWindow(input.periodStart);
  if (window.periodStart !== input.periodStart || window.resetAt !== input.resetAt) throw new RangeError("비용 기간은 서울 날짜 기준 월 전체여야 합니다.");
  const limit: number = (input.category === "ai" ? policy.aiMonthlyKrw : policy.operationsMonthlyKrw) * policy.moneyScale;
  return executeAtomic(db, context, "cost.window", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO cost_windows VALUES (?,?,1,?,?,?,?,'KRW',1000000,?,0,0)").bind(context.owner.userId, input.id, requestId, input.category, input.periodStart, input.resetAt, limit)]);
}
export async function reserveCost(db: D1Database, context: Command, value: CostReservationInput): Promise<Receipt> {
  const input: CostReservationInput = costReservationInput.parse(value);
  return executeAtomic(db, context, "cost.reserve", input, input.windowId, context.expectedVersion + 1, (requestId: string) => [
    requireInBatch(db, context.owner.userId, requestId, 1, "?=0 OR NOT EXISTS(SELECT 1 FROM ai_funding_checks WHERE owner_id=? AND json_type(snapshot,'$.prepaidProbe')='object')", [input.amountUnits, context.owner.userId]),
    ...guardedUpdate(db, "cost_windows", context.owner.userId, input.windowId, context.expectedVersion, requestId, 0, "reserved_units = reserved_units + ?", [input.amountUnits], "period_start <= ? AND reset_at > ? AND ((category = 'ai' AND ? = 'gpt-6-luna') OR (category = 'operations' AND ? = 'operations'))", [input.now, input.now, input.model, input.model]),
    db.prepare("INSERT INTO cost_reservations VALUES (?,?,1,?,?,?,?,?,'reserved',NULL)").bind(context.owner.userId, input.id, requestId, input.windowId, input.businessKey, input.model, input.amountUnits),
  ]);
}
export async function markCostUnknown(db: D1Database, context: Command, reservationId: string): Promise<Receipt> {
  recordId.parse(reservationId);
  return executeAtomic(db, context, "cost.unknown", { reservationId }, reservationId, context.expectedVersion + 1, (requestId: string) => guardedUpdate(db, "cost_reservations", context.owner.userId, reservationId, context.expectedVersion, requestId, 0, "state = 'unknown'", [], "state = 'reserved'", []));
}
/** AI 응답 상태와 같은 배치에서 정산할 수 있도록 SQL 계획을 공유합니다. */
export function costSettlementStatements(db: D1Database, context: Command, input: SettlementInput, requestId: string): readonly D1PreparedStatement[] {
  settlementInput.parse(input);
  return [
    ...guardedUpdate(db, "cost_reservations", context.owner.userId, input.reservationId, context.expectedVersion, requestId, 0, "state = 'settled', actual_units = ?", [input.actualUnits], "state IN ('reserved','unknown') AND window_id = ? AND amount_units >= ?", [input.windowId, input.actualUnits]),
    ...guardedUpdate(db, "cost_windows", context.owner.userId, input.windowId, input.windowVersion, requestId, 1, "reserved_units = reserved_units - (SELECT amount_units FROM cost_reservations WHERE owner_id = ? AND id = ?), settled_units = settled_units + ?", [context.owner.userId, input.reservationId, input.actualUnits], "1", []),
    db.prepare("INSERT INTO cost_usage VALUES (?,?,?,?,?,?,?)").bind(context.owner.userId, crypto.randomUUID(), input.reservationId, input.actualUnits, input.providerReceipt, input.occurredAt, requestId),
  ];
}
export async function settleCost(db: D1Database, context: Command, value: SettlementInput): Promise<Receipt> {
  const input: SettlementInput = settlementInput.parse(value);
  return executeAtomic(db, context, "cost.settle", input, input.reservationId, context.expectedVersion + 1, (requestId: string) => costSettlementStatements(db, context, input, requestId));
}
export async function releaseCost(db: D1Database, context: Command, reservationId: string, windowId: string, windowVersion: number): Promise<Receipt> {
  recordId.parse(reservationId); recordId.parse(windowId); version.parse(windowVersion);
  return executeAtomic(db, context, "cost.release", { windowId, windowVersion }, reservationId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "cost_reservations", context.owner.userId, reservationId, context.expectedVersion, requestId, 0, "state = 'released'", [], "state = 'reserved' AND window_id = ?", [windowId]),
    ...guardedUpdate(db, "cost_windows", context.owner.userId, windowId, windowVersion, requestId, 1, "reserved_units = reserved_units - (SELECT amount_units FROM cost_reservations WHERE owner_id = ? AND id = ?)", [context.owner.userId, reservationId], "1", []),
  ]);
}
export async function createQuotaWindow(db: D1Database, context: Command, value: QuotaWindowInput): Promise<Receipt> {
  const input: QuotaWindowInput = quotaWindowInput.parse(value);
  return executeAtomic(db, context, "quota.window", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO quota_windows VALUES (?,?,1,?,?,?,?,?,?,?,?,0,0)").bind(context.owner.userId, input.id, requestId, input.api, input.projectKey, input.providerUser, input.quotaUnit, input.periodStart, input.resetAt, input.limitUnits)]);
}
export async function reserveQuota(db: D1Database, context: Command, value: QuotaReservationInput): Promise<Receipt> {
  const input: QuotaReservationInput = quotaReservationInput.parse(value);
  return executeAtomic(db, context, "quota.reserve", input, input.windowId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "quota_windows", context.owner.userId, input.windowId, context.expectedVersion, requestId, 0, "reserved_units = reserved_units + ?", [input.weight], "period_start <= ? AND reset_at > ?", [input.now, input.now]),
    db.prepare("INSERT INTO quota_reservations VALUES (?,?,1,?,?,?,?,?,'reserved',NULL)").bind(context.owner.userId, input.id, requestId, input.windowId, input.businessKey, input.method, input.weight),
  ]);
}
export async function markQuotaUnknown(db: D1Database, context: Command, reservationId: string): Promise<Receipt> {
  recordId.parse(reservationId);
  return executeAtomic(db, context, "quota.unknown", { reservationId }, reservationId, context.expectedVersion + 1, (requestId: string) => guardedUpdate(db, "quota_reservations", context.owner.userId, reservationId, context.expectedVersion, requestId, 0, "state = 'unknown'", [], "state = 'reserved'", []));
}
export async function settleQuota(db: D1Database, context: Command, value: SettlementInput): Promise<Receipt> {
  const input: SettlementInput = settlementInput.parse(value);
  return executeAtomic(db, context, "quota.settle", input, input.reservationId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "quota_reservations", context.owner.userId, input.reservationId, context.expectedVersion, requestId, 0, "state = 'settled', actual_units = ?", [input.actualUnits], "state IN ('reserved','unknown') AND window_id = ? AND weight >= ?", [input.windowId, input.actualUnits]),
    ...guardedUpdate(db, "quota_windows", context.owner.userId, input.windowId, input.windowVersion, requestId, 1, "reserved_units = reserved_units - (SELECT weight FROM quota_reservations WHERE owner_id = ? AND id = ?), settled_units = settled_units + ?", [context.owner.userId, input.reservationId, input.actualUnits], "1", []),
    db.prepare("INSERT INTO quota_usage VALUES (?,?,?,?,?,?,?)").bind(context.owner.userId, crypto.randomUUID(), input.reservationId, input.actualUnits, input.providerReceipt, input.occurredAt, requestId),
  ]);
}
export async function releaseQuota(db: D1Database, context: Command, reservationId: string, windowId: string, windowVersion: number): Promise<Receipt> {
  recordId.parse(reservationId); recordId.parse(windowId); version.parse(windowVersion);
  return executeAtomic(db, context, "quota.release", { windowId, windowVersion }, reservationId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "quota_reservations", context.owner.userId, reservationId, context.expectedVersion, requestId, 0, "state = 'released'", [], "state = 'reserved' AND window_id = ?", [windowId]),
    ...guardedUpdate(db, "quota_windows", context.owner.userId, windowId, windowVersion, requestId, 1, "reserved_units = reserved_units - (SELECT weight FROM quota_reservations WHERE owner_id = ? AND id = ?)", [context.owner.userId, reservationId], "1", []),
  ]);
}
