import type { UsageDashboard } from "../../lib/dashboard/usage";
import { aiCapability } from "../../lib/ai/support";
import { fixtureVisionBudget } from "./vision-budget";

/** 브라우저 동작 검사 전용 합성 지원 관측이며 실제 계정 확인 증거가 아닙니다. */
export function fixtureTutorBudget(now: number): UsageDashboard {
  const data = fixtureVisionBudget(now);
  return { ...data, ai: { ...data.ai, support: aiCapability.options.map((capability) => ({ capability, state: "verified", validUntil: now + 86_400_000 })) } };
}
