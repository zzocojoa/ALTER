import type { UsageDashboard } from "../../lib/dashboard/usage";
import { fixtureUsageDashboard } from "./dashboard-usage";

/** UI 사전 차단 검사만을 위한 합성 원장이며 운영 설정을 변경하지 않습니다. */
export function fixtureVisionBudget(now: number): UsageDashboard {
  const data: UsageDashboard = fixtureUsageDashboard(now);
  const pricing = data.ai.pricing;
  if (pricing === null) throw new Error("합성 가격이 필요합니다.");
  const period = { checkedAt: now, validFrom: now, validUntil: now + 86_400_000 };
  return { ...data, ai: { ...data.ai, pricing: { ...pricing, pricing: { ...pricing.pricing, provenance: { ...pricing.pricing.provenance, ...period, evidence: "verified" } }, exchange: { ...pricing.exchange, provenance: { ...pricing.exchange.provenance, ...period } }, tax: { ...pricing.tax, provenance: { ...pricing.tax.provenance, ...period } }, fee: { ...pricing.fee, provenance: { ...pricing.fee.provenance, ...period } } } } };
}
