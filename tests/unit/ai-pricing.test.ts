import { describe, expect, it } from "vitest";
import { calculateTokenReservation, calculateUsageCost, calculateUsdAmount, pricingFingerprint, requirePricingAt, requireVerifiedPricing, tokenUsage } from "../../lib/ai/pricing";
import type { TokenUsage } from "../../lib/ai/pricing";
import { fixturePricing } from "../fixtures/ai-pricing";

const usage: TokenUsage = { inputTokens: 1000, cachedInputTokens: 200, cacheWriteTokens: 100, cacheWriteTtl: "30m", outputTokens: 1000, reasoningTokens: 500, totalTokens: 2000 };

describe("정확한 버전별 비용 계산", (): void => {
  it("입력·캐시 쓰기·추론을 중복 과금하지 않는다", (): void => {
    const amount = calculateUsageCost(usage, fixturePricing(), 150);
    expect(amount.units).toBe(655_809);
    expect(amount.kind).toBe("usage-calculated");
    expect(amount).not.toHaveProperty("providerInvoice");
    expect(calculateUsageCost({ ...usage, reasoningTokens: 0 }, fixturePricing(), 150).units).toBe(amount.units);
    expect(calculateTokenReservation(1000, 1000, fixturePricing(), 150).units).toBe(841_500);
  });
  it("최종 원화 마이크로 단위에서만 올림한다", (): void => {
    const base = fixturePricing();
    const exact = { ...base, exchange: { ...base.exchange, krwPerUsd: "1" }, tax: { ...base.tax, multiplier: "1" }, fee: { ...base.fee, multiplier: "1" } };
    expect(calculateUsdAmount("0.0000001", exact, 150).units).toBe(1);
    expect(calculateUsdAmount("0.000001", exact, 150).units).toBe(1);
    expect(calculateUsdAmount("0.000001000001", exact, 150).units).toBe(2);
    expect(calculateUsdAmount("0", exact, 150).units).toBe(0);
  });
  it("과거 설정은 새 요금과 무관하게 재현되며 지문은 변경을 식별한다", async (): Promise<void> => {
    const original = fixturePricing();
    const before = JSON.stringify(original);
    const changed = { ...original, pricing: { ...original.pricing, short: { ...original.pricing.short, output: "5" } } };
    expect(calculateUsageCost(usage, changed, 150).units).toBeGreaterThan(calculateUsageCost(usage, original, 150).units);
    expect(calculateUsageCost(usage, original, 150).units).toBe(655_809);
    expect(await pricingFingerprint(changed)).not.toBe(await pricingFingerprint(original));
    expect(JSON.stringify(original)).toBe(before);
  });
  it("설정 누락·범위·통화·유효 기간은 기본값 없이 거부한다", (): void => {
    const base = fixturePricing();
    expect(() => requirePricingAt({ ...base, tax: undefined } as unknown as typeof base, 150)).toThrow();
    expect(() => requirePricingAt({ ...base, exchange: { ...base.exchange, quote: "USD/KRW" } } as unknown as typeof base, 150)).toThrow();
    for (const now of [99, 1000]) expect(() => requirePricingAt(base, now)).toThrow(expect.objectContaining({ code: "ai_pricing_invalid" }));
    expect(() => calculateUsdAmount("1000000000000", base, 150)).toThrow(expect.objectContaining({ field: "money.safe-integer" }));
    expect(() => requirePricingAt({ ...base, fee: { ...base.fee, multiplier: "0.9" } }, 150)).toThrow();
    expect(() => requireVerifiedPricing(base, 150)).toThrow(expect.objectContaining({ field: "evidence" }));
  });
  it("불완전하거나 서로 모순되는 usage는 정산하지 않는다", (): void => {
    for (const value of [{ ...usage, inputTokens: -1 }, { ...usage, inputTokens: 0.5 }, { ...usage, totalTokens: 1000 }, { ...usage, cachedInputTokens: 1001 }, { ...usage, reasoningTokens: 1001 }, { ...usage, cacheWriteTtl: "unknown" }]) expect(tokenUsage.safeParse(value).success).toBe(false);
  });
  it("긴 문맥 요율과 캐시 수명을 구분한다", (): void => {
    const base = fixturePricing();
    const short: TokenUsage = { inputTokens: 272_000, cachedInputTokens: 0, cacheWriteTokens: 0, cacheWriteTtl: "30m", outputTokens: 16, reasoningTokens: 0, totalTokens: 272_016 };
    const long: TokenUsage = { ...short, inputTokens: 272_001, totalTokens: 272_017 };
    expect(calculateUsageCost(long, base, 150).units).toBeGreaterThan(calculateUsageCost(short, base, 150).units * 1.9);
    expect(calculateUsageCost({ ...usage, cacheWriteTtl: "12h" }, base, 150).units).toBeGreaterThan(calculateUsageCost(usage, base, 150).units);
  });
  it("추론 포함 출력 한계를 빠뜨리거나 모델 상한을 넘는 예약을 거부한다", (): void => {
    for (const values of [[1000, 0], [1000, 128_001], [922_001, 64], [1000, Number.NaN]]) expect(() => calculateTokenReservation(values[0], values[1], fixturePricing(), 150)).toThrow();
  });
});
