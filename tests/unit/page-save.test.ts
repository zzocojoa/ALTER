import { expect, it } from "vitest";
import { pageSaveAttempt, savedPageMatches } from "../../app/learn/materials/page-save";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000001";
const nextId: string = "00000000-0000-4000-a000-000000000002";
const page: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 1, version: 2, resultVersion: 1, resultId: id, state: "complete", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: { filePage: 1, method: "plain-text", status: "complete", width: null, height: null, rotation: 0, segments: [{ id: "s0", kind: "text", text: "원문", bounds: null, transform: null, uncertain: false, reason: null }], error: null, requiresConfirmation: true } };
it("쪽수가 같아도 기록 판이 진행되지 않았으면 저장 성공으로 보지 않는다", (): void => {
  const attempt = pageSaveAttempt(page, { kind: "label", printedPage: "iii" }, "fixture-key");
  expect(savedPageMatches({ ...page, printedPage: "iii" }, attempt)).toBe(false);
  expect(savedPageMatches({ ...page, version: 3, printedPage: "iii" }, attempt)).toBe(true);
  expect(savedPageMatches({ ...page, version: 3, printedPage: "iv" }, attempt)).toBe(false);
});
it("같은 쪽수여도 다른 선택 범위·페이지·작업의 응답은 거절한다", (): void => {
  const attempt = pageSaveAttempt(page, { kind: "label", printedPage: null }, "fixture-key");
  for (const change of [{ id: nextId }, { jobId: nextId }, { filePage: 3 }, { selectionRevision: 2 }, { version: 1 }]) expect(() => savedPageMatches({ ...page, version: 3, ...change }, attempt)).toThrow("저장 응답");
});
it("본문 정정은 새 결과 판과 모든 구간 내용의 일치가 필요하다", (): void => {
  if (page.result === null) throw new Error("합성 원문이 없습니다.");
  const attempt = pageSaveAttempt(page, { kind: "edit", segments: [{ id: "s0", text: "정정" }] }, "fixture-key");
  const changed: StoredExtractionPage = { ...page, version: 3, resultId: nextId, resultVersion: 2, result: { ...page.result, method: "manual-correction", segments: [{ ...page.result.segments[0], text: "정정" }] } };
  expect(savedPageMatches(changed, attempt)).toBe(true);
  expect(savedPageMatches({ ...changed, resultId: id }, attempt)).toBe(false);
  expect(savedPageMatches({ ...changed, result: { ...page.result, method: "manual-correction" } }, attempt)).toBe(false);
  expect(savedPageMatches({ ...changed, state: "unknown" }, attempt)).toBe(false);
});
it("확인 구간은 요청한 결과 판과 쪽수·구간이 모두 같아야 한다", (): void => {
  const attempt = pageSaveAttempt(page, { kind: "confirm", segmentIds: ["s0"], comparedWithOriginal: true, printedPage: null }, "fixture-key");
  const checked: StoredExtractionPage = { ...page, version: 3, confirmedSegmentIds: ["s0"] };
  expect(savedPageMatches(checked, attempt)).toBe(true);
  expect(savedPageMatches({ ...checked, resultId: nextId }, attempt)).toBe(false);
  expect(savedPageMatches({ ...checked, confirmedSegmentIds: [] }, attempt)).toBe(false);
});
