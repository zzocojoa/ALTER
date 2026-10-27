import type { UsageDashboard } from "../dashboard/usage";
import { usageAvailability } from "../dashboard/availability";
import { dashboardIsStale } from "../dashboard/contracts";
import { requireDispatchPricing } from "../ai/pricing";
import type { AiCapability } from "../ai/support";

export const aiCapabilityLabels: Readonly<Record<AiCapability, string>> = { text: "텍스트", image: "사진 판독", "structured-output": "응답 형식", streaming: "스트리밍", usage: "사용량 확인", "output-limit": "출력 한도" };

/** 관측된 차단 사유만 표시하며 화면 확인을 요청별 서버 승인으로 간주하지 않습니다. */
export function aiRequestIssues(data: UsageDashboard | null, required: readonly AiCapability[], now: number): readonly string[] {
  if (data === null) return ["비용·지원 상태를 먼저 확인해 주세요. 이 조회는 AI를 호출하지 않아요."];
  const issues: string[] = [];
  if (dashboardIsStale(data.asOf, now)) issues.push("비용 관측이 오래됐어요. 현재 상태를 다시 읽어 주세요.");
  const budget = usageAvailability(data, now).services.aiBudget;
  if (budget.state === "blocked") issues.push(budget.reason);
  if (data.ai.configuration !== "configured") issues.push("AI 운영 설정을 확인하지 못했어요.");
  if (!data.ai.funding || !data.ai.funding.current || data.ai.funding.checkedAt > now || data.ai.funding.validUntil <= now) issues.push("결제 근거의 확인 기간이 만료됐거나 미확인이에요.");
  if (!data.ai.pricing) issues.push("가격·환산 근거가 없어요.");
  else {
    try { requireDispatchPricing(data.ai.pricing, now); }
    catch (error: unknown) { if (!(error instanceof Error) || error.name !== "PricingFailure") throw error; issues.push("가격·환산 근거의 확인 기간이 유효하지 않아요."); }
  }
  for (const capability of required) {
    const condition = data.ai.support.find((item): boolean => item.capability === capability);
    if (condition?.state === "denied") issues.push(`${aiCapabilityLabels[capability]} 기능은 현재 계정에서 지원 거부가 기록돼 있어요.`);
    else if (!condition || condition.state !== "verified" || condition.validUntil === null || condition.validUntil <= now) issues.push(`${aiCapabilityLabels[capability]} 지원 확인이 만료됐거나 미확인이에요.`);
  }
  return [...new Set(issues)];
}
