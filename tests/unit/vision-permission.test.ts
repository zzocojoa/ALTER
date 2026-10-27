import { expect, it } from "vitest";
import { visionUnavailableReason } from "../../app/learn/materials/vision-permission";
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
