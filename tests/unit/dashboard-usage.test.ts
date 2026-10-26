import { describe, expect, it } from "vitest";
import { displayConfiguration, publicFunding, usageDashboard } from "../../lib/dashboard/usage";
import { fixtureFunding, fixturePrepaidProbe } from "../fixtures/ai-funding";
import { fixturePricing } from "../fixtures/ai-pricing";
import { fixtureUsageDashboard } from "../fixtures/dashboard-usage";
const now: number = Date.parse("2026-10-25T03:00:00Z");
const config = { ...fixturePrepaidProbe(fixtureFunding("owner", fixturePricing().id, now), fixturePricing()), support: [], credentialFingerprint: "b".repeat(64) };
describe("사용량 표시와 결제 근거", () => {
  it("확정 비용·예약·미확인 잔액을 구분하고 비밀값과 계정 지문을 제외한다", () => {
    const value = publicFunding(config, now);
    expect(value).toMatchObject({ paidKrwUnits: 0, committedKrwUnits: 10_000_000_000, liveProviderBalance: null, pendingPayment: { status: "pending", paidUsdMicros: 5_500_000 }, probeLimitUsdMicros: 50_000 });
    expect(JSON.stringify(value)).not.toMatch(/Fingerprint|reconciledReservationIds|ownerId|credential/);
    const data = usageDashboard.parse(fixtureUsageDashboard(now));
    expect(data.ai.windows[0]).toMatchObject({ settled: 1_000_000, reserved: 500_000, unknown: 200_000 });
    expect(data.google.pickerQueries).toBeNull(); expect(data.platform.accountR2Remaining).toBeNull();
  });
  it("미등록·손상·소유자 및 가격 버전 불일치를 정상 설정으로 표시하지 않는다", () => {
    expect(displayConfiguration(undefined, "owner").state).toBe("missing");
    expect(displayConfiguration("{broken", "owner").state).toBe("invalid");
    expect(displayConfiguration(JSON.stringify(config), "other").state).toBe("owner-mismatch");
    expect(displayConfiguration(JSON.stringify(config), "owner").state).toBe("configured");
    expect(displayConfiguration(JSON.stringify({ ...config, funding: { ...config.funding, pricingVersionId: "00000000-0000-4000-a000-000000000200" } }), "owner").state).toBe("invalid");
  });
  it("만료·시간 역행과 다음 달 미확정 결제 예약을 유지한다", () => {
    expect(publicFunding(config, now - 1).current).toBe(false);
    expect(publicFunding(config, config.funding.validUntil).current).toBe(false);
    expect(publicFunding(config, Date.parse("2026-11-01T03:00:00Z")).committedKrwUnits).toBe(10_000_000_000);
  });
  it("원화 확정 결제와 기존 구독료를 분리하고 새 가격을 현재 값으로 읽는다", () => {
    const pricing = { ...fixturePricing(), exchange: { ...fixturePricing().exchange, krwPerUsd: "1500" } };
    const value = { pricing, funding: { ...fixtureFunding("owner", pricing.id, now), payments: [{ id: "topup", kind: "credit-topup" as const, units: 8_000_000_000, paidAt: now }, { id: "subscription", kind: "existing-subscription" as const, units: 30_000_000_000, paidAt: now }] }, support: [] };
    expect(publicFunding(value, now)).toMatchObject({ paidKrwUnits: 8_000_000_000, committedKrwUnits: 8_000_000_000, pendingPayment: null });
    expect(displayConfiguration(JSON.stringify(value), "owner").value?.pricing.exchange.krwPerUsd).toBe("1500");
  });
});
