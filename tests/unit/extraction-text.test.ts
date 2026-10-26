import { describe, expect, it, vi } from "vitest";
import { positionText, validatePageResult } from "../../lib/extraction/result";
import type { PageResult } from "../../lib/extraction/result";
import { extractSelectedText } from "../../app/learn/materials/extract-text";
import type { PdfDocumentHandle } from "../../app/learn/materials/pdf-document";
import type { SelectionBinding } from "../../lib/extraction/selection";

const binding: SelectionBinding = { jobId: "00000000-0000-4000-8000-000000000001", revision: 1, selection: { materialId: "00000000-0000-4000-8000-000000000002" as SelectionBinding["selection"]["materialId"], originalVersion: "v1", originalHash: "a".repeat(64), pages: [{ filePage: 2, purpose: "contents" }, { filePage: 4, purpose: "study" }] } };
const item = { str: "x² + y²", transform: [12, 0, 0, 12, 10, 80], width: 40, height: 12, hasEOL: true };
const geometry = { width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100] };

describe("선택 텍스트와 좌표 보존", (): void => {
  it("수식 문자를 해석하지 않고 위치·순서·불확실성을 남긴다", (): void => {
    const segments = positionText([item, { ...item, str: "표 A | B", transform: [12, 0, 0, 12, 10, 50] }], geometry);
    expect(segments[0]).toMatchObject({ text: "x² + y²\n", bounds: { x: 0.1, y: 0.08, width: 0.4, height: 0.12000000000000001 }, transform: item.transform, uncertain: true });
    expect(segments[1].text).toBe("표 A | B\n"); expect(item.str).toBe("x² + y²");
  });
  it("페이지 밖 문자를 표시 범위로 제한하면서 확인 사유를 남긴다", (): void => { const segment = positionText([{ ...item, transform: [12, 0, 0, 12, -20, 80] }], geometry)[0]; expect(segment.bounds?.x).toBe(0); expect(segment.reason).toContain("페이지 밖"); });
  it("정수가 아닌 좌표는 허용하되 NaN과 비정상 크기는 거부한다", (): void => { expect(() => positionText([{ ...item, width: NaN }], geometry)).toThrow(); expect(() => positionText([item], { ...geometry, height: 0 })).toThrow(); });
  it("부분 실패 후에도 다른 선택 페이지만 저장하고 리소스를 정리한다", async (): Promise<void> => {
    const cleanup = vi.fn();
    const getPage = vi.fn(async (page: number) => { if (page === 2) throw new Error("page-2-corrupt"); return { getViewport: () => geometry, getTextContent: async () => ({ items: [item] }), cleanup, rotate: 0 }; });
    const handle = { document: { getPage }, assertCurrent: vi.fn(), close: vi.fn(), etag: '"v1"' } as unknown as PdfDocumentHandle;
    const results: PageResult[] = [];
    await extractSelectedText(handle, binding, new AbortController().signal, async (result: PageResult): Promise<void> => { results.push(result); });
    expect(getPage.mock.calls.map(([page]): number => page)).toEqual([2, 4]); expect(results.map((result): string => result.status)).toEqual(["failed", "complete"]); expect(results[1].requiresConfirmation).toBe(true); expect(cleanup).toHaveBeenCalledOnce();
  });
  it("취소 이후 다음 페이지를 읽지 않는다", async (): Promise<void> => {
    const abort: AbortController = new AbortController();
    const getPage = vi.fn(async () => ({ getViewport: () => geometry, getTextContent: async () => ({ items: [item] }), cleanup: vi.fn(), rotate: 0 }));
    const handle = { document: { getPage }, assertCurrent: vi.fn(), close: vi.fn(), etag: '"v1"' } as unknown as PdfDocumentHandle;
    await expect(extractSelectedText(handle, binding, abort.signal, async (): Promise<void> => { abort.abort(); })).rejects.toThrow(); expect(getPage).toHaveBeenCalledTimes(1);
  });
  it("빈 페이지와 그림만 있는 페이지를 구분한다", async (): Promise<void> => {
    const getPage = vi.fn(async (page: number) => ({ getViewport: () => geometry, getTextContent: async () => ({ items: [] }), getOperatorList: async () => ({ fnArray: page === 2 ? [] : [85] }), cleanup: vi.fn(), rotate: 0 }));
    const handle = { document: { getPage }, assertCurrent: vi.fn(), close: vi.fn(), etag: '"v1"' } as unknown as PdfDocumentHandle;
    const results: PageResult[] = []; await extractSelectedText(handle, binding, new AbortController().signal, async (result: PageResult): Promise<void> => { results.push(result); }); expect(results.map((result): string => result.status)).toEqual(["blank", "no-text"]);
  });
  it("다른 페이지·좌표 초과·중복 구간을 결과로 받지 않는다", (): void => {
    const result: PageResult = { filePage: 1, method: "text-layer", status: "complete", width: 100, height: 100, rotation: 0, segments: [...positionText([item], geometry)], error: null, requiresConfirmation: true };
    expect(() => validatePageResult(result, 2)).toThrow(); expect(() => validatePageResult({ ...result, segments: [result.segments[0], result.segments[0]] }, 1)).toThrow();
    expect(() => validatePageResult({ ...result, segments: [{ ...result.segments[0], bounds: { x: 0.9, y: 0, width: 0.3, height: 0.1 } }] }, 1)).toThrow();
  });
});
