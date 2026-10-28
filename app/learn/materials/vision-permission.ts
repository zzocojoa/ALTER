import { requireDispatchPricing } from "@/lib/ai/pricing";
import { dashboardIsStale } from "@/lib/dashboard/contracts";
import { usageAvailability } from "@/lib/dashboard/availability";
import type { UsageDashboard } from "@/lib/dashboard/usage";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import { isMaterialResponseFailure } from "./client-api";

export type VisionBlock = Readonly<{ code: "running" | "unknown" | "unobserved" | "query-failed" | "stale" | "budget" | "configuration" | "funding" | "pricing" | "approval" | "save-unconfirmed"; reason: string; action: "read-cost" | "cost-details" | "request-result" | "saved-state" }>;

/** 화면에서 확인한 제한만 사전 차단하며 요청별 서버 승인을 대신하지 않습니다. */
export function visionBlock(page: StoredExtractionPage, data: UsageDashboard | null, now: number): VisionBlock | null {
  if (page.state === "running" || page.state === "unknown") return { code: page.state, reason: "기존 판독 결과 확인이 먼저 필요해요. 새 판독을 중복 실행하지 않아요.", action: "request-result" };
  if (data === null) return { code: "unobserved", reason: "저장된 비용·승인 조건을 먼저 확인해 주세요. 이 조회에는 AI 비용이 들지 않아요.", action: "read-cost" };
  if (dashboardIsStale(data.asOf, now)) return { code: "stale", reason: "비용 관측이 오래됐어요. 저장된 비용·승인 조건을 다시 확인해 주세요.", action: "read-cost" };
  const condition = usageAvailability(data, now).services.aiBudget;
  if (condition.state === "blocked") return { code: "budget", reason: condition.reason, action: "cost-details" };
  if (data.ai.configuration !== "configured" || data.ai.pricing === null || data.ai.funding === null) return { code: "configuration", reason: "AI 설정·가격·결제 근거가 미확인이에요. 사용량과 비용 화면에서 설정을 확인해 주세요.", action: "cost-details" };
  if (!data.ai.funding.current || data.ai.funding.checkedAt > now || data.ai.funding.validUntil <= now) return { code: "funding", reason: "결제 관측의 확인 기간이 만료됐어요. 실행 전에 결제 근거를 다시 확인해 주세요.", action: "cost-details" };
  try { requireDispatchPricing(data.ai.pricing, now); }
  catch (error: unknown) {
    if (!(error instanceof Error) || error.name !== "PricingFailure") throw error;
    return { code: "pricing", reason: "가격·환산 근거가 현재 유효하지 않아요. 사용량과 비용 화면에서 확인해 주세요.", action: "cost-details" };
  }
  return null;
}

export function visionUnavailableReason(page: StoredExtractionPage, data: UsageDashboard | null, now: number): string | null {
  return visionBlock(page, data, now)?.reason ?? null;
}

/** 서버의 정확한 거부 항목만 안내로 옮기고 결과가 불명확한 요청은 재전송 전에 조회하도록 합니다. */
export function visionSubmissionBlock(error: unknown): VisionBlock {
  if (isMaterialResponseFailure(error)) {
    const operation: string | null = error.operation ?? null;
    if (error.code === "reference_conflict" && operation !== null && (operation.startsWith("extraction.approved-image-") || ["extraction.vision.fixed-acceptance-only", "coffee.approved-page", "coffee.approval-expired"].includes(operation))) return { code: "approval", reason: "이 자료·페이지·이미지가 현재 승인 범위와 일치하지 않아요. 새 입력 승인을 자동으로 확대하지 않습니다. 원본을 보며 직접 전사할 수 있어요.", action: "cost-details" };
    if (error.code === "ai_funding_unverified") return { code: "funding", reason: "서버에서 현재 결제 근거를 확인하지 못했어요. 사용량과 비용 화면에서 확인해 주세요.", action: "cost-details" };
    if (error.code === "ai_pricing_invalid") return { code: "pricing", reason: "서버에서 가격·환산 근거를 거부했어요. 현재 비용 조건을 확인해 주세요.", action: "cost-details" };
    if (["ai_configuration_required", "ai_key_required", "ai_key_mismatch"].includes(error.code)) return { code: "configuration", reason: "서버의 AI 설정을 확인해야 해요. 사용량과 비용 화면에서 확인해 주세요.", action: "cost-details" };
    if (["ai_credit_required", "additional_budget_exceeded"].includes(error.code) || error.code === "limit_exceeded" && operation === "ai.probe.cumulative-cap") return { code: "budget", reason: "현재 승인된 예산이나 기존 크레딧으로 판독할 수 없어요. 자동·추가 충전 없이 직접 전사할 수 있어요.", action: "cost-details" };
  }
  return { code: "save-unconfirmed", reason: "판독 요청의 저장 결과가 아직 확인되지 않았어요. 다시 실행하기 전에 저장 상태를 조회해 주세요.", action: "saved-state" };
}

export function visionCostReadFailure(detail: string): VisionBlock {
  return { code: "query-failed", reason: `비용 조회 실패. 무료로 저장된 조건을 다시 확인해 주세요. ${detail}`, action: "read-cost" };
}
