import { requireConfiguredKey } from "../../lib/ai/configuration.ts";
import { contentHash } from "../../lib/domain/contracts.ts";
import { describe, expect, it } from "vitest";
import { fundingSnapshot, monthlyPaidUnits, monthlyCommittedUnits, requireAiFunding, requireFundingSnapshot, requireGoogleFreeOperation } from "../../lib/ai/funding.ts";
import type { FundingExposure, GoogleFreeContract } from "../../lib/ai/funding.ts";
import { fixtureFunding, fixturePrepaidProbe } from "../fixtures/ai-funding.ts";
import { fixturePricing } from "../fixtures/ai-pricing.ts";
import { approvedScopes } from "../../lib/domain/contracts.ts";

const now: number = Date.parse("2026-10-24T00:00:00Z");
const exposure: FundingExposure = { aiUnreconciledSettledUnits: 0, aiReservedUnits: 0, operationsUnreconciledSettledUnits: 0, operationsReservedUnits: 0 };
const snapshot = fixtureFunding("owner", "123e4567-e89b-42d3-a456-426614174000", now);
const google: GoogleFreeContract = { operation: "confirmed-report-export", existingContentConfirmed: true, selectedByOwner: true, directRestOAuth: true, freeTierVerified: true, requestedScopes: approvedScopes, limitUnits: 100, usedAndReservedUnits: 90, requiredUnits: 10 };

describe("충전과 소비 및 추가 운영비 분리", () => {
  it("충전으로 충당한 소비는 다시 운영비에 합산하지 않는다", () => {
    const prepaid = { ...snapshot, creditAvailableUnits: 7_000_000_000, payments: [{ id: "topup", kind: "credit-topup" as const, units: 7_000_000_000, paidAt: now }, { id: "subscription", kind: "existing-subscription" as const, units: 40_000_000_000, paidAt: now }] };
    expect(monthlyPaidUnits(prepaid, now)).toBe(7_000_000_000);
    expect(() => requireAiFunding(prepaid, { ...exposure, aiUnreconciledSettledUnits: 3_000_000_000 }, 4_000_000_000, now)).not.toThrow();
    expect(() => fundingSnapshot.parse({ ...prepaid, payments: [...prepaid.payments, prepaid.payments[0]] })).toThrow();
  });
  it("최소 충전도 만원 상한을 넘으면 차단하고 자동 충전을 거부한다", () => {
    expect(() => requireAiFunding({ ...snapshot, creditAvailableUnits: 0, minimumTopupUnits: 11_000_000_000 }, exposure, 1, now)).toThrow(expect.objectContaining({ code: "additional_budget_exceeded" }));
    expect(() => requireAiFunding({ ...snapshot, creditAvailableUnits: 0 }, exposure, 1, now)).toThrow(expect.objectContaining({ code: "ai_credit_required" }));
    expect(() => fundingSnapshot.parse({ ...snapshot, automaticRecharge: true })).toThrow();
  });
  it("후불 소비·예약과 실제 월 청구 결제를 함께 검사한다", () => {
    const postpaid = { ...snapshot, billingMode: "postpaid" as const, creditAvailableUnits: 0, payments: [{ id: "invoice-payment", kind: "api-invoice" as const, units: 4_000_000_000, paidAt: now }] };
    expect(() => requireAiFunding(postpaid, { ...exposure, aiUnreconciledSettledUnits: 5_000_000_000, aiReservedUnits: 1_000_000_000 }, 1, now)).toThrow();
    expect(() => requireAiFunding(postpaid, exposure, 6_000_000_000, now)).not.toThrow();
  });
  it("만료·다른 소유자·다른 가격 버전은 차단한다", () => {
    expect(() => requireFundingSnapshot(snapshot, "wrong", snapshot.pricingVersionId, now)).toThrow();
    expect(() => requireFundingSnapshot(snapshot, "owner", snapshot.pricingVersionId, snapshot.validUntil)).toThrow();
  });
});
describe("미확정 결제 예약", () => {
  it("승인된 30센트와 과거 5·8센트 기록만 허용하고 기존 잔액을 검사한다", () => {
    const pending = fixturePrepaidProbe(snapshot, fixturePricing()).funding;
    expect(fundingSnapshot.parse(pending).prepaidProbe?.limitUsdMicros).toBe(50_000);
    const increased = { ...pending, prepaidProbe: { ...pending.prepaidProbe, limitUsdMicros: 80_000, creditAvailableUsdMicros: 80_000 } };
    expect(fundingSnapshot.parse(increased).prepaidProbe?.limitUsdMicros).toBe(80_000);
    expect(fundingSnapshot.parse({ ...pending, prepaidProbe: { ...pending.prepaidProbe, limitUsdMicros: 300000 } }).prepaidProbe?.limitUsdMicros).toBe(300000);
    expect(monthlyCommittedUnits(fundingSnapshot.parse(increased), now)).toBe(10_000_000_000);
    expect(() => fundingSnapshot.parse({ ...increased, prepaidProbe: { ...increased.prepaidProbe, creditAvailableUsdMicros: 79_999 } })).toThrow();
    expect(() => fundingSnapshot.parse({ ...increased, prepaidProbe: { ...increased.prepaidProbe, limitUsdMicros: 80_001 } })).toThrow();
  });
  it("운영 키 비교는 원문 없이 형식 오류만 반환하고 공백을 임의 제거하지 않는다", async () => {
    const key: string = "sk-proj-fixture-not-real";
    const fingerprint: string = await contentHash(key);
    await expect(requireConfiguredKey(key, fingerprint)).resolves.toBeUndefined();
    await expect(requireConfiguredKey(key + " ", fingerprint)).rejects.toMatchObject({ code: "ai_key_mismatch", hasWhitespace: true, hasProjectKeyPrefix: true });
    await expect(requireConfiguredKey("OPENAI_API_KEY=" + key, fingerprint)).rejects.toMatchObject({ hasAssignmentPrefix: true });
  });
  it("실제 원화 지출과 예약을 구분하고 월 경계에도 예약을 유지한다", () => {
    const pending = fixturePrepaidProbe(snapshot, fixturePricing()).funding;
    expect(monthlyPaidUnits(pending, now)).toBe(0);
    expect(monthlyCommittedUnits(pending, now)).toBe(10_000_000_000);
    expect(monthlyCommittedUnits(pending, Date.parse("2026-11-01T00:00:00Z"))).toBe(10_000_000_000);
    expect(() => requireAiFunding(pending, exposure, 1, now)).not.toThrow();
    expect(() => requireAiFunding(pending, { ...exposure, operationsReservedUnits: 1 }, 1, now)).toThrow();
    expect(() => fundingSnapshot.parse({ ...pending, billingMode: "postpaid", creditAvailableUnits: 0 })).toThrow();
    expect(() => fundingSnapshot.parse({ ...pending, prepaidProbe: { ...pending.prepaidProbe, limitUsdMicros: 50_001 } })).toThrow();
    expect(() => fundingSnapshot.parse({ ...pending, prepaidProbe: { ...pending.prepaidProbe, additionalPurchasesAllowed: true } })).toThrow();
    expect(() => fundingSnapshot.parse({ ...pending, payments: [{ id: "fixture-pending-invoice", kind: "credit-topup", units: 9000, paidAt: now }] })).toThrow();
  });
});
describe("AI와 Google 무료 작업 독립", () => {
  it("AI 잔액이 없어도 이미 확정된 무료 작업은 자체 한도로 판단한다", () => {
    expect(() => requireGoogleFreeOperation(google)).not.toThrow();
    expect(() => requireGoogleFreeOperation({ ...google, operation: "selected-reference-read", existingContentConfirmed: false })).not.toThrow();
    expect(() => requireGoogleFreeOperation({ ...google, usedAndReservedUnits: 91 })).toThrow();
  });
  it("새 AI 분석·무료 미확인·권한 확대는 무료 작업으로 통과하지 않는다", () => {
    expect(() => requireGoogleFreeOperation({ ...google, operation: "new-summary" as GoogleFreeContract["operation"] })).toThrow();
    expect(() => requireGoogleFreeOperation({ ...google, freeTierVerified: false })).toThrow();
    expect(() => requireGoogleFreeOperation({ ...google, requestedScopes: ["https://www.googleapis.com/auth/drive"] })).toThrow();
  });
});
