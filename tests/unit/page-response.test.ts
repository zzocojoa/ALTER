import { expect, it } from "vitest";
import { mergePageSnapshot, requirePageResponse } from "../../app/learn/materials/page-response";
import type { StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000831";
const page: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 1, version: 1, resultVersion: 0, resultId: null, state: "pending", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result: null };
it("늦은 조회는 현재보다 최신인 결과만 적용하며 입력을 바꾸지 않는다", (): void => {
  const latest: StoredExtractionPage = { ...page, version: 3, printedPage: "iii" };
  expect(mergePageSnapshot([latest], [page])).toEqual([latest]); expect(page.version).toBe(1);
  expect(mergePageSnapshot([page], [latest])).toEqual([latest]);
  const revision: StoredExtractionPage = { ...page, id: "00000000-0000-4000-a000-000000000832", selectionRevision: 2 };
  expect(mergePageSnapshot([latest], [revision])).toEqual([revision]);
  expect(() => mergePageSnapshot([page], [{ ...page, resultId: id }])).toThrow("같은 기록 판");
});
it("요청과 다른 페이지·작업·선택·오래된 판은 응답으로 적용하지 않는다", (): void => {
  for (const change of [{ id: "another" }, { jobId: "another" }, { selectionRevision: 2 }, { filePage: 2 }, { version: 0 }]) expect(() => requirePageResponse({ ...page, ...change }, page)).toThrow();
  expect(() => requirePageResponse({ ...page, version: 2 }, page)).not.toThrow();
  expect(() => requirePageResponse({ ...page, version: 3 }, { ...page, version: 2, resultVersion: 1 })).toThrow();
});
