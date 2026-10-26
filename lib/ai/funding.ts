import { coffeeProbeReceipt } from "./coffee-probe.ts";
import { z } from "zod";
import { approvedScopes, policy, recordId, timestamp } from "../domain/contracts.ts";
import { seoulMonthWindow } from "../../db/repositories/usage.ts";

const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const payment = z.object({ id: z.string().min(1).max(200), kind: z.enum(["credit-topup", "api-invoice", "other-operation", "existing-subscription"]), units, paidAt: timestamp }).strict();
const prepaidProbe = z.object({
  limitUsdMicros: z.union([z.literal(50_000), z.literal(80_000), z.literal(300_000)]), creditAvailableUsdMicros: units,
  additionalPurchasesAllowed: z.literal(false),
  pendingPayment: z.object({ id: z.string().min(1).max(200), paidUsdMicros: units.refine((value): boolean => value > 0), paidAt: timestamp, krwStatus: z.literal("pending"), reservedKrwUnits: z.literal(10_000_000_000) }).strict(),
}).strict().refine((value): boolean => value.creditAvailableUsdMicros >= value.limitUsdMicros, { message: "기존 선불 크레딧이 승인된 누적 검증 한도보다 적습니다." });
/** 잔액은 reconciledReservationIds의 소비를 이미 반영한 값이며 다른 항목은 DB에서 다시 차감합니다. */
export const fundingSnapshot = z.object({
  coffeeProbe: coffeeProbeReceipt.optional(), prepaidProbe: prepaidProbe.optional(), reservationUsdMicros: units.optional(),
  id: recordId, ownerId: z.string().min(1).max(200), accountFingerprint: z.string().regex(/^[a-f0-9]{64}$/), pricingVersionId: recordId,
  billingMode: z.enum(["prepaid", "postpaid"]), creditAvailableUnits: units, minimumTopupUnits: units,
  reconciledReservationIds: z.array(recordId).max(10_000), payments: z.array(payment).max(1000),
  automaticRecharge: z.literal(false), source: z.string().url(), checkedAt: timestamp, validUntil: timestamp, evidence: z.literal("verified"),
}).strict().refine((value): boolean => (!value.coffeeProbe || value.prepaidProbe?.limitUsdMicros === 300000) && value.validUntil > value.checkedAt && new Set(value.reconciledReservationIds).size === value.reconciledReservationIds.length && new Set(value.payments.map((item): string => item.id)).size === value.payments.length && (value.billingMode !== "postpaid" || value.creditAvailableUnits === 0) && (!value.prepaidProbe || value.billingMode === "prepaid" && value.payments.every((item): boolean => item.id !== value.prepaidProbe?.pendingPayment.id)));
export type FundingSnapshot = Readonly<z.infer<typeof fundingSnapshot>>;
export type FundingExposure = Readonly<{ aiUnreconciledSettledUnits: number; aiReservedUnits: number; operationsUnreconciledSettledUnits: number; operationsReservedUnits: number }>;
export type FundingFailure = Error & Readonly<{ code: "ai_funding_unverified" | "ai_credit_required" | "additional_budget_exceeded"; requiredUnits: number | null }>;
function fail(code: FundingFailure["code"], requiredUnits: number | null): never { throw Object.assign(new Error("결제·잔액 근거와 추가 운영비 한도를 확인해야 합니다. 자동 충전은 실행하지 않습니다."), { name: "FundingFailure", code, requiredUnits }); }
export function requireFundingSnapshot(value: FundingSnapshot, ownerId: string, pricingVersionId: string, now: number): FundingSnapshot {
  const snapshot: FundingSnapshot = fundingSnapshot.parse(value);
  if (snapshot.ownerId !== ownerId || snapshot.pricingVersionId !== pricingVersionId || snapshot.checkedAt > now || snapshot.validUntil <= now || snapshot.payments.some((item): boolean => item.paidAt > snapshot.checkedAt) || snapshot.prepaidProbe && snapshot.prepaidProbe.pendingPayment.paidAt > snapshot.checkedAt) fail("ai_funding_unverified", null);
  return snapshot;
}
export function monthlyPaidUnits(snapshot: FundingSnapshot, now: number): number {
  const period = seoulMonthWindow(now);
  const amount: bigint = snapshot.payments.filter((item): boolean => item.kind !== "existing-subscription" && item.paidAt >= period.periodStart && item.paidAt < period.resetAt).reduce((sum: bigint, item): bigint => sum + BigInt(item.units), BigInt(0));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) fail("additional_budget_exceeded", null);
  return Number(amount);
}
/** 미확정 결제는 실제 지출과 구분하며 대사 전까지 월 전체 예산을 계속 점유합니다. */
export function monthlyCommittedUnits(snapshot: FundingSnapshot, now: number): number {
  const result: bigint = BigInt(monthlyPaidUnits(snapshot, now)) + BigInt(snapshot.prepaidProbe?.pendingPayment.reservedKrwUnits ?? 0);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail("additional_budget_exceeded", null);
  return Number(result);
}
/** 소비와 충전 결제는 별도 지표이며 선불 소비를 충전액에 다시 더하지 않습니다. */
export function requireAiFunding(snapshot: FundingSnapshot, exposure: FundingExposure, newReservationUnits: number, now: number): void {
  units.parse(newReservationUnits); Object.values(exposure).forEach((value: number): void => { units.parse(value); });
  const ai: bigint = BigInt(exposure.aiUnreconciledSettledUnits) + BigInt(exposure.aiReservedUnits) + BigInt(newReservationUnits);
  const additional: bigint = BigInt(monthlyCommittedUnits(snapshot, now)) + BigInt(exposure.operationsUnreconciledSettledUnits) + BigInt(exposure.operationsReservedUnits) + (snapshot.billingMode === "postpaid" ? ai : BigInt(0));
  if (additional > BigInt(policy.operationsMonthlyKrw * policy.moneyScale)) fail("additional_budget_exceeded", null);
  if (snapshot.billingMode === "prepaid" && ai > BigInt(snapshot.creditAvailableUnits)) {
    const shortage: bigint = ai - BigInt(snapshot.creditAvailableUnits);
    const minimum: bigint = shortage > BigInt(snapshot.minimumTopupUnits) ? shortage : BigInt(snapshot.minimumTopupUnits);
    if (additional + minimum > BigInt(policy.operationsMonthlyKrw * policy.moneyScale)) fail("additional_budget_exceeded", minimum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minimum) : null);
    fail("ai_credit_required", minimum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minimum) : null);
  }
}
export type FreeGoogleOperation = "confirmed-report-export" | "calendar-registration" | "selected-reference-read";
export type GoogleFreeContract = Readonly<{ operation: FreeGoogleOperation; existingContentConfirmed: boolean; selectedByOwner: boolean; directRestOAuth: boolean; freeTierVerified: boolean; requestedScopes: readonly string[]; limitUnits: number; usedAndReservedUnits: number; requiredUnits: number }>;
/** AI 예산을 입력으로 받지 않으며 새 분석·새 요약은 이 무료 작업 계약에 포함하지 않습니다. */
export function requireGoogleFreeOperation(input: GoogleFreeContract): void {
  z.enum(["confirmed-report-export", "calendar-registration", "selected-reference-read"]).parse(input.operation);
  if (!input.directRestOAuth || !input.freeTierVerified || !input.selectedByOwner || input.operation !== "selected-reference-read" && !input.existingContentConfirmed) throw new Error("Google 무료 작업의 선택·확정·무료 이용 근거가 필요합니다.");
  if (input.requestedScopes.length === 0 || input.requestedScopes.some((value): boolean => !(approvedScopes as readonly string[]).includes(value))) throw new Error("승인된 Google 최소 권한 범위를 벗어났습니다.");
  [input.limitUnits, input.usedAndReservedUnits, input.requiredUnits].forEach((value: number): void => { units.parse(value); });
  if (BigInt(input.usedAndReservedUnits) + BigInt(input.requiredUnits) > BigInt(input.limitUnits)) throw new Error("Google 무료 사용 한도에 도달했습니다.");
}
