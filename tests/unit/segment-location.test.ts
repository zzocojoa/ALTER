import { describe, expect, it } from "vitest";
import { originalSegmentLocation } from "../../app/learn/materials/segment-location";
import { boundedImageGeometry, boundedPdfRegionGeometry } from "../../lib/extraction/image";
import type { PageRotation, ImageGeometry } from "../../lib/extraction/image";
import type { ExtractedSegment, PageResult, Rectangle } from "../../lib/extraction/result";
import type { ImageMetadata, StoredExtractionPage } from "../../lib/extraction/state";

const id: string = "00000000-0000-4000-a000-000000000001";
const bounds: Rectangle = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
const segment: ExtractedSegment = { id: "s0", kind: "formula", text: "1/4", bounds, transform: null, uncertain: true, reason: "원본 대조 필요" };
const result: PageResult = { filePage: 1, method: "vision", status: "complete", width: 200, height: 100, rotation: 0, segments: [segment], error: null, requiresConfirmation: true };
const page: StoredExtractionPage = { id, jobId: id, selectionRevision: 1, filePage: 1, version: 2, resultVersion: 1, resultId: id, state: "complete", printedPage: null, pendingAiKey: null, pendingImage: null, resultImage: null, failure: null, confirmedSegmentIds: [], result };
function image(geometry: ImageGeometry, rotation: PageRotation): ImageMetadata {
  return { ...geometry, sourceToImage: [...geometry.sourceToImage], mime: "image/png", bytes: 100, sha256: "a".repeat(64), sourceWidth: 200, sourceHeight: 100, rotation, coordinateSpace: "decoded-image" };
}
function expectBounds(actual: ReturnType<typeof originalSegmentLocation>, expected: Rectangle): void {
  expect(actual.kind).toBe("located");
  if (actual.kind !== "located") throw new Error(actual.reason);
  for (const key of ["x", "y", "width", "height"] as const) expect(actual.bounds[key]).toBeCloseTo(expected[key], 10);
}

describe("원본 구간 좌표", (): void => {
  it("텍스트층의 표시 좌표에 PDF 회전을 중복 적용하지 않는다", (): void => {
    expectBounds(originalSegmentLocation({ ...page, result: { ...result, method: "text-layer", rotation: 90 } }, segment), bounds);
  });
  for (const sample of [
    { rotation: 0, expected: bounds },
    { rotation: 90, expected: { x: 0.2, y: 0.6, width: 0.4, height: 0.3 } },
    { rotation: 180, expected: { x: 0.6, y: 0.4, width: 0.3, height: 0.4 } },
    { rotation: 270, expected: { x: 0.4, y: 0.1, width: 0.4, height: 0.3 } }
  ] as const) {
    it(`${sample.rotation}도 판독 이미지의 수식 영역을 원본에 연결한다`, (): void => {
      expectBounds(originalSegmentLocation({ ...page, resultImage: image(boundedImageGeometry(200, 100, sample.rotation), sample.rotation) }, segment), sample.expected);
    });
  }
  it("영역 판독과 그 정정본을 전체 원본의 위치에 연결한다", (): void => {
    const region = { x: 0.25, y: 0.2, width: 0.5, height: 0.6 };
    const metadata: ImageMetadata = { ...image(boundedPdfRegionGeometry(200, 100, region, 0), 0), coordinateSpace: "pdf-region", region };
    const table: ExtractedSegment = { ...segment, kind: "table", bounds: { x: 0.2, y: 0.25, width: 0.4, height: 0.5 } };
    expectBounds(originalSegmentLocation({ ...page, resultImage: metadata }, table), { x: 0.35, y: 0.35, width: 0.2, height: 0.3 });
    expectBounds(originalSegmentLocation({ ...page, result: { ...result, method: "manual-correction" }, resultImage: metadata }, table), { x: 0.35, y: 0.35, width: 0.2, height: 0.3 });
  });
  it("좌표나 변환이 없거나 원본 범위를 벗어나면 임의 위치를 만들지 않는다", (): void => {
    expect(originalSegmentLocation(page, segment).kind).toBe("unavailable");
    expect(originalSegmentLocation(page, { ...segment, bounds: null }).kind).toBe("unavailable");
    expect(originalSegmentLocation(page, { ...segment, bounds: { ...bounds, width: 0 } }).kind).toBe("unavailable");
    const metadata: ImageMetadata = image(boundedImageGeometry(200, 100, 0), 0);
    expect(originalSegmentLocation({ ...page, resultImage: { ...metadata, sourceToImage: [0, 0, 0, 0, 0, 0] } }, segment).kind).toBe("unavailable");
    expect(originalSegmentLocation({ ...page, resultImage: { ...metadata, sourceToImage: [1, 0, 0, 1, 999, 999] } }, segment).kind).toBe("unavailable");
  });
});
