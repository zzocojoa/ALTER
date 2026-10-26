import { pricingVersion } from "../../lib/ai/pricing.ts";
import type { PricingVersion } from "../../lib/ai/pricing.ts";

/** 공식 모델 단가와 합성 환율·세금을 결합한 검사 전용 설정입니다. */
export function fixturePricing(): PricingVersion {
  const provenance = { source: "https://example.test/test-only", checkedAt: 100, validFrom: 100, validUntil: 1000, evidence: "fixture" } as const;
  return pricingVersion.parse({
    id: "00000000-0000-4000-8000-000000000100", model: "gpt-6-luna", currency: "USD", tokenPriceUnit: 1_000_000,
    pricing: { provenance: { ...provenance, source: "https://developers.openai.com/api/docs/pricing" }, short: { input: "0.10", cachedInput: "0.01", cacheWrite30m: "0.125", cacheWrite12h: "0.25", output: "0.50" }, long: { input: "0.20", cachedInput: "0.02", cacheWrite30m: "0.25", cacheWrite12h: "0.50", output: "0.75" }, longContextThreshold: 272_000 },
    exchange: { provenance, quote: "KRW/USD", krwPerUsd: "1000" }, tax: { provenance, multiplier: "1.1" }, fee: { provenance, multiplier: "1.02" },
  });
}
