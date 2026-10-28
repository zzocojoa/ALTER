import { expect, it } from "vitest";
import { visionUnavailableReason, visionBlock, visionSubmissionBlock, visionCostReadFailure } from "../../app/learn/materials/vision-permission";
import { fixtureVisionBudget } from "../fixtures/vision-budget";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000001";
const page: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 1, version: 1, resultVersion: 0, resultId: null, state: "pending", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: null };
const now: number = 500_000;

it("원장을 읽지 않았거나 오래된 값이면 실행을 허용하지 않는다", (): void => {
  expect(visionUnavailableReason(page, null, now)).toContain("먼저 확인");
  expect(visionUnavailableReason(page, fixtureVisionBudget(now), now + 300_000)).toContain("오래됐어요");
});
it("이미 실행 중이거나 누적 상한을 소진하면 새 판독을 차단한다", (): void => {
  const data = fixtureVisionBudget(now);
  expect(visionUnavailableReason({ ...page, state: "unknown" }, data, now)).toContain("기존 판독 결과");
  expect(visionUnavailableReason({ ...page, state: "running" }, data, now)).toContain("기존 판독 결과");
  expect(visionUnavailableReason(page, { ...data, ai: { ...data.ai, probeCommittedUsdMicros: 50_000 } }, now)).toContain("누적 검증 상한");
});
it("설정·결제·가격 미확인을 현재 허가로 표시하지 않는다", (): void => {
  const data = fixtureVisionBudget(now); const funding = data.ai.funding; const pricing = data.ai.pricing;
  if (funding === null || pricing === null) throw new Error("합성 가격과 결제 근거가 필요합니다.");
  expect(visionUnavailableReason(page, { ...data, ai: { ...data.ai, configuration: "missing" } }, now)).toContain("미확인");
  expect(visionUnavailableReason(page, { ...data, ai: { ...data.ai, funding: { ...funding, validUntil: now } } }, now)).toContain("확인 기간");
  expect(visionUnavailableReason(page, { ...data, ai: { ...data.ai, pricing: { ...pricing, pricing: { ...pricing.pricing, provenance: { ...pricing.pricing.provenance, validFrom: now - 1, checkedAt: now - 1, validUntil: now } } } } }, now)).toContain("현재 유효하지");
  expect(visionUnavailableReason(page, data, now)).toBeNull();
});

it("차단별 해결 행동을 구분하고 조회 실패·불명 요청은 자동 재전송하지 않는다", (): void => {
  const data = fixtureVisionBudget(now); const funding = data.ai.funding; const pricing = data.ai.pricing;
  if (funding === null || pricing === null) throw new Error("합성 가격과 결제 근거가 필요합니다.");
  expect(visionBlock(page, null, now)).toMatchObject({ code: "unobserved", action: "read-cost" });
  expect(visionCostReadFailure("503")).toMatchObject({ code: "query-failed", action: "read-cost" });
  expect(visionBlock(page, data, now + 300_000)).toMatchObject({ code: "stale", action: "read-cost" });
  expect(visionBlock({ ...page, state: "running" }, data, now)).toMatchObject({ code: "running", action: "request-result" });
  expect(visionBlock({ ...page, state: "unknown" }, data, now)).toMatchObject({ code: "unknown", action: "request-result" });
  expect(visionBlock(page, { ...data, ai: { ...data.ai, probeCommittedUsdMicros: 50_000 } }, now)).toMatchObject({ code: "budget", action: "cost-details" });
  expect(visionBlock(page, { ...data, ai: { ...data.ai, configuration: "missing" } }, now)).toMatchObject({ code: "configuration", action: "cost-details" });
  expect(visionBlock(page, { ...data, ai: { ...data.ai, funding: { ...funding, validUntil: now } } }, now)).toMatchObject({ code: "funding", action: "cost-details" });
  expect(visionBlock(page, { ...data, ai: { ...data.ai, pricing: { ...pricing, pricing: { ...pricing.pricing, provenance: { ...pricing.pricing.provenance, checkedAt: now - 1, validFrom: now - 1, validUntil: now } } } } }, now)).toMatchObject({ code: "pricing", action: "cost-details" });
  expect(visionSubmissionBlock(new TypeError("network reset"))).toMatchObject({ code: "save-unconfirmed", action: "saved-state" });
});
it("서버 승인 거부를 원본 변경과 구별하며 오류 항목을 그대로 사용한다", (): void => {
  const rejection = Object.assign(new Error("서버 거부"), { name: "MaterialResponseFailure", status: 409, code: "reference_conflict", field: null, operation: "extraction.vision.fixed-acceptance-only" });
  expect(visionSubmissionBlock(rejection)).toMatchObject({ code: "approval", action: "cost-details" });
  expect(visionSubmissionBlock(Object.assign(new Error("원본 변경"), { ...rejection, operation: "extraction.page.binding" }))).toMatchObject({ code: "save-unconfirmed" });
  for (const [code, expected] of [["ai_funding_unverified", "funding"], ["ai_pricing_invalid", "pricing"], ["ai_credit_required", "budget"], ["additional_budget_exceeded", "budget"], ["ai_configuration_required", "configuration"], ["ai_key_required", "configuration"]] as const) {
    expect(visionSubmissionBlock(Object.assign(new Error(code), { name: "MaterialResponseFailure", status: 503, code, field: null }))).toMatchObject({ code: expected, action: "cost-details" });
  }
});
