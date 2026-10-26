import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedImageGeometry, boundedPdfGeometry, preparedPageImage, requireImageGeometry } from "../../lib/extraction/image";
import type { PageRotation } from "../../lib/extraction/image";
import { preparePdfPageImage } from "../../app/learn/materials/prepare-page-image";
import type { PdfDocumentHandle } from "../../app/learn/materials/pdf-document";
import type { SelectionBinding } from "../../lib/extraction/selection";

const binding: SelectionBinding = { jobId: crypto.randomUUID(), revision: 1, selection: { materialId: crypto.randomUUID() as SelectionBinding["selection"]["materialId"], originalVersion: "v1", originalHash: "a".repeat(64), pages: [{ filePage: 2, purpose: "study" }] } };
afterEach((): void => { vi.unstubAllGlobals(); });
describe("판독 이미지 상한과 자원 해제", (): void => {
  for (const rotation of [0, 90, 180, 270] as const) it(`고해상도 회전 ${rotation}의 모서리가 캔버스 범위에 들어간다`, (): void => {
    const result = boundedImageGeometry(8000, 2000, rotation);
    expect(Math.max(result.width, result.height)).toBe(3200); expect(result.width * result.height).toBeLessThanOrEqual(2560000);
    const m = result.sourceToImage;
    for (const [x, y] of [[0, 0], [8000, 0], [0, 2000], [8000, 2000]]) { const px: number = m[0] * x + m[2] * y + m[4]; const py: number = m[1] * x + m[3] * y + m[5]; expect(px).toBeGreaterThanOrEqual(0); expect(py).toBeGreaterThanOrEqual(0); expect(px).toBeLessThanOrEqual(result.width); expect(py).toBeLessThanOrEqual(result.height); }
  });
  for (const rotation of [0, 90, 180, 270] as const) it(`픽셀 상한 안의 긴 손글씨는 회전 ${rotation}에서도 원본 해상도를 유지한다`, (): void => {
    const result = boundedImageGeometry(534, 3074, rotation);
    expect([result.width, result.height]).toEqual(rotation === 90 || rotation === 270 ? [3074, 534] : [534, 3074]);
    expect(result.width * result.height).toBe(1641516);
  });
  it("작은 이미지는 확대하지 않고 초대형 페이지도 제한한다", (): void => { expect(boundedImageGeometry(10, 20, 0)).toMatchObject({ width: 10, height: 20 }); expect(boundedImageGeometry(1000000, 1000000, 0)).toMatchObject({ width: 1600, height: 1600 }); });
  it("긴 변과 픽셀 한도를 따로 적용하고 입력 좌표 위조를 거부한다", (): void => {
    expect(boundedImageGeometry(100, 8000, 0)).toMatchObject({ width: 51, height: 4096 });
    const original = preparedPageImage.parse({ dataUrl: "data:image/png;base64,AQ==", mime: "image/png", bytes: 1, sha256: "a".repeat(64), width: 534, height: 3074, sourceWidth: 534, sourceHeight: 3074, rotation: 0, sourceToImage: [1, 0, 0, 1, 0, 0], coordinateSpace: "decoded-image" });
    expect(() => requireImageGeometry(original)).not.toThrow();
    expect(() => requireImageGeometry({ ...original, width: 535 })).toThrow("좌표 변환");
    expect(() => requireImageGeometry({ ...original, width: 4096, height: 4096, sourceWidth: 4096, sourceHeight: 4096 })).toThrow("좌표 변환");
    expect(preparedPageImage.safeParse({ ...original, height: 4097 }).success).toBe(false);
    expect(preparedPageImage.safeParse({ ...original, bytes: 2097153 }).success).toBe(false);
    expect(preparedPageImage.safeParse({ ...original, width: 277, height: 1599, sourceToImage: [277 / 534, 0, 0, 1599 / 3074, 0, 0] }).success).toBe(true);
  });
  it("읽을 수 없는 극단 비율·잘못된 크기·회전을 거부한다", (): void => { for (const [width, height] of [[0, 10], [NaN, 10], [1, 1000000]]) expect(() => boundedImageGeometry(width, height, 0)).toThrow(); expect(() => boundedImageGeometry(10, 10, 45 as PageRotation)).toThrow(); });
  for (const failure of ["memory", "bytes", "cancel"] as const) it(`${failure}에서도 선택한 페이지와 캔버스를 해제한다`, async (): Promise<void> => {
    const cleanup = vi.fn(); const cancel = vi.fn(); const abort: AbortController = new AbortController();
    const canvas = { width: 0, height: 0, toBlob: (callback: (value: Blob | null) => void): void => { if (failure === "cancel") abort.abort(); callback(failure === "memory" ? null : new Blob([new Uint8Array(2097153)], { type: "image/png" })); } };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    const getPage = vi.fn(async () => ({ getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve(), cancel }), cleanup }));
    const handle = { document: { getPage }, assertCurrent: vi.fn() } as unknown as PdfDocumentHandle;
    await expect(preparePdfPageImage(handle, binding, 2, 0, abort.signal)).rejects.toThrow(); expect(canvas.width).toBe(0); expect(canvas.height).toBe(0); expect(cleanup).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalled(); expect(getPage).toHaveBeenCalledExactlyOnceWith(2);
  });
  it("미선택 페이지는 렌더링을 시작하지 않는다", async (): Promise<void> => { const getPage = vi.fn(); const handle = { document: { getPage }, assertCurrent: vi.fn() } as unknown as PdfDocumentHandle; await expect(preparePdfPageImage(handle, binding, 3, 0, new AbortController().signal)).rejects.toThrow("선택하지 않은"); expect(getPage).not.toHaveBeenCalled(); });
});

for (const rotation of [0, 90, 180, 270] as const) it(`PDF 포인트 좌표를 고해상도 픽셀로 변환하고 회전 ${rotation} 좌표를 검증한다`, () => {
  const geometry = boundedPdfGeometry(595, 841, rotation);
  expect(Math.max(geometry.width, geometry.height)).toBeGreaterThan(1800);
  expect(geometry.width * geometry.height).toBeLessThanOrEqual(2560000);
  const image = preparedPageImage.parse({ dataUrl: "data:image/png;base64,AQ==", mime: "image/png", bytes: 1, sha256: "a".repeat(64), ...geometry, sourceWidth: 595, sourceHeight: 841, rotation, coordinateSpace: "pdf-raster" });
  expect(() => requireImageGeometry(image)).not.toThrow();
  expect(() => requireImageGeometry({ ...image, coordinateSpace: "decoded-image" })).toThrow();
  for (const [x,y] of [[0,0],[595,0],[0,841],[595,841]]) {
    const m = geometry.sourceToImage; const px = m[0]*x+m[2]*y+m[4]; const py = m[1]*x+m[3]*y+m[5];
    expect(px).toBeGreaterThanOrEqual(-0.000001); expect(py).toBeGreaterThanOrEqual(-0.000001);
    expect(px).toBeLessThanOrEqual(geometry.width+0.000001); expect(py).toBeLessThanOrEqual(geometry.height+0.000001);
  }
});
it("이전 PDF 판독 이미지는 보존하고 새 PDF는 3배를 넘겨 확대하지 않는다", () => {
  expect(boundedPdfGeometry(100, 100, 0)).toMatchObject({ width: 300, height: 300 });
  const legacy = preparedPageImage.parse({ dataUrl: "data:image/png;base64,AQ==", mime: "image/png", bytes: 1, sha256: "a".repeat(64), ...boundedImageGeometry(595,841,0), sourceWidth: 595, sourceHeight: 841, rotation: 0, coordinateSpace: "pdf-viewport" });
  expect(() => requireImageGeometry(legacy)).not.toThrow();
});
