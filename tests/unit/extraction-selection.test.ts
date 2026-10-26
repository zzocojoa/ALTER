import { describe, expect, it } from "vitest";
import { buildSelection, parsePageSelection, requireSelectedPage, validateSelection } from "../../lib/extraction/selection";
import type { MaterialFileReference } from "../../lib/materials/attachment";

const file: MaterialFileReference = { materialId: "00000000-0000-4000-8000-000000000001", kind: "pdf", role: "textbook", bytes: 1000, pages: 100, sha256: "a".repeat(64), objectVersion: "v1", sourceUrl: "/api/materials/00000000-0000-4000-8000-000000000001/file" };
describe("선택 범위와 원본 결합", (): void => {
  it("중복 정규화와 파일 번호 1을 유지한다", (): void => { expect(parsePageSelection("3, 1, 3-5", 100)).toEqual([1, 3, 4, 5]); });
  for (const input of ["", " ", "0", "-1", "1.5", "2-1", "1,", "101", "1-21", "1e2", "NaN", "1,2-21"]) it(`범위 오류 ${JSON.stringify(input)}를 거부한다`, (): void => { expect(() => parsePageSelection(input, 100)).toThrow(); });
  it("목차와 본문 범위를 고정하고 입력은 변경하지 않는다", (): void => { expect(buildSelection(file, "1", "5-6").pages).toEqual([{ filePage: 1, purpose: "contents" }, { filePage: 5, purpose: "study" }, { filePage: 6, purpose: "study" }]); expect(file.objectVersion).toBe("v1"); });
  it("목차와 본문 중복 또는 빈 선택을 거부한다", (): void => { expect(() => buildSelection(file, "1", "1")).toThrow(); expect(() => buildSelection(file, "", "")).toThrow(); });
  it("사진과 텍스트는 실제 1페이지 범위만 받는다", (): void => { expect(() => buildSelection({ ...file, kind: "image", pages: 1 }, "", "2")).toThrow(); });
  it("원본과 선택 버전 위조 또는 미선택 페이지를 거부한다", (): void => {
    const selection = buildSelection(file, "1", "3");
    for (const changed of [{ objectVersion: "v2" }, { materialId: crypto.randomUUID() }, { sha256: "b".repeat(64) }]) expect(() => validateSelection(selection, { ...file, ...changed })).toThrow();
    const binding = { jobId: crypto.randomUUID(), revision: 1, selection };
    expect(() => requireSelectedPage(binding, binding.jobId, 2, 1)).toThrow(); expect(() => requireSelectedPage(binding, binding.jobId, 1, 2)).toThrow();
    expect(requireSelectedPage(binding, binding.jobId, 1, 3).filePage).toBe(3);
  });
  it("클라이언트 객체 키와 중복 페이지를 받지 않는다", (): void => { const selection = buildSelection(file, "1", "3"); expect(() => validateSelection({ ...selection, objectKey: "other" }, file)).toThrow(); expect(() => validateSelection({ ...selection, pages: [selection.pages[0], selection.pages[0]] }, file)).toThrow(); });
});
