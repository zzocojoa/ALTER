import { recordId } from "../../lib/domain/contracts.ts";
import type { PricingVersion } from "../../lib/ai/pricing.ts";
import type { FundingSnapshot } from "../../lib/ai/funding.ts";

/** 모의 API 전용 자금 증거이며 실제 계정 잔액을 의미하지 않습니다. */
export function fixtureFunding(ownerId: string, pricingVersionId: string, now: number): FundingSnapshot {
  return { id: recordId.parse(crypto.randomUUID()), ownerId, accountFingerprint: "a".repeat(64), pricingVersionId: recordId.parse(pricingVersionId), billingMode: "prepaid", creditAvailableUnits: 20_000_000_000, minimumTopupUnits: 5_000_000_000, reconciledReservationIds: [], payments: [], automaticRecharge: false, source: "https://example.invalid/fixture-funding", checkedAt: now, validUntil: now + 86_400_000, evidence: "verified" };
}

/** 미확정 결제와 검사 전용 예산 계수는 실제 청구 근거로 표시하지 않습니다. */
export function fixturePrepaidProbe(funding: FundingSnapshot, pricing: PricingVersion): Readonly<{ funding: FundingSnapshot; pricing: PricingVersion }> {
  const provenance = { ...pricing.exchange.provenance, evidence: "budget-policy" as const };
  return {
    pricing: { ...pricing, purpose: "prepaid-probe", exchange: { ...pricing.exchange, provenance, krwPerUsd: "2000" }, tax: { provenance, multiplier: "1" }, fee: { provenance, multiplier: "1" } },
    funding: { ...funding, creditAvailableUnits: 10_000_000_000, prepaidProbe: { limitUsdMicros: 50_000, creditAvailableUsdMicros: 5_000_000, additionalPurchasesAllowed: false, pendingPayment: { id: "fixture-pending-invoice", paidUsdMicros: 5_500_000, paidAt: funding.checkedAt, krwStatus: "pending", reservedKrwUnits: 10_000_000_000 } } },
  };
}
