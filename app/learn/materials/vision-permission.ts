import { requireDispatchPricing } from "@/lib/ai/pricing";
import { dashboardIsStale } from "@/lib/dashboard/contracts";
import { usageAvailability } from "@/lib/dashboard/availability";
import type { UsageDashboard } from "@/lib/dashboard/usage";
import type { StoredExtractionPage } from "@/lib/extraction/state";

/** 화면에서 확인한 제한만 사전 차단하며 요청별 서버 승인을 대신하지 않습니다. */
export function visionUnavailableReason(page: StoredExtractionPage, data: UsageDashboard | null, now: number): string | null {
  if (page.state === "running" || page.state === "unknown") return "기존 판독 결과 확인이 먼저 필요해요. 새 판독을 중복 실행하지 않아요.";
  if (data === null) return "저장된 비용·승인 조건을 먼저 확인해 주세요. 이 조회에는 AI 비용이 들지 않아요.";
  if (dashboardIsStale(data.asOf, now)) return "비용 관측이 오래됐어요. 저장된 비용·승인 조건을 다시 확인해 주세요.";
  const condition = usageAvailability(data, now).services.aiBudget;
  if (condition.state === "blocked") return condition.reason;
  if (data.ai.configuration !== "configured" || data.ai.pricing === null || data.ai.funding === null) return "AI 설정·가격·결제 근거가 미확인이에요. 사용량과 비용 화면에서 설정을 확인해 주세요.";
  if (!data.ai.funding.current || data.ai.funding.checkedAt > now || data.ai.funding.validUntil <= now) return "결제 관측의 확인 기간이 만료됐어요. 실행 전에 결제 근거를 다시 확인해 주세요.";
  try { requireDispatchPricing(data.ai.pricing, now); }
  catch (error: unknown) { if (!(error instanceof Error) || error.name !== "PricingFailure") throw error; return "가격·환산 근거가 현재 유효하지 않아요. 사용량과 비용 화면에서 확인해 주세요."; }
  return null;
}
