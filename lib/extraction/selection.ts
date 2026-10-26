import { z } from "zod";
import { recordId } from "../domain/contracts.ts";
import type { MaterialFileReference } from "../materials/attachment.ts";

export const extractionLimits = Object.freeze({ pagesPerSelection: 20, segmentsPerPage: 1000, charactersPerPage: 60000, imageLongSide: 4096, imagePixels: 2560000, imageBytes: 2097152 } as const);
export const selectedPage = z.object({ filePage: z.number().int().min(1).max(500), purpose: z.enum(["contents", "study"]) }).strict();
export const selectionInput = z.object({ materialId: recordId, originalVersion: z.string().min(1).max(300), originalHash: z.string().regex(/^[a-f0-9]{64}$/), pages: z.array(selectedPage).min(1).max(extractionLimits.pagesPerSelection) }).strict();
export type SelectedPage = Readonly<z.infer<typeof selectedPage>>;
export type SelectionInput = Readonly<Omit<z.infer<typeof selectionInput>, "pages"> & { pages: readonly SelectedPage[] }>;
export type SelectionBinding = Readonly<{ jobId: string; revision: number; selection: SelectionInput }>;

/** 1부터 시작하는 파일 번호만 해석하며 빈 항목과 역순을 자동 보정하지 않습니다. */
export function parsePageSelection(value: string, totalPages: number): readonly number[] {
  if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > 500) throw new RangeError("등록된 원본의 페이지 수가 필요해요.");
  if (value.trim().length === 0 || value.length > 1000) throw new RangeError("선택할 파일 페이지를 입력해 주세요.");
  const entries: readonly number[][] = value.split(",").map((part: string): number[] => {
    const match: RegExpMatchArray | null = part.trim().match(/^([1-9]\d*)(?:\s*-\s*([1-9]\d*))?$/);
    if (match === null) throw new RangeError("파일 페이지는 1, 3-5처럼 정수로 입력해 주세요.");
    const first: number = Number(match[1]); const last: number = match[2] === undefined ? first : Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last || last > totalPages) throw new RangeError("선택 범위가 역순이거나 원본 페이지 수를 벗어났어요.");
    if (last - first + 1 > extractionLimits.pagesPerSelection) throw new RangeError("한 번에 최대 20페이지를 선택할 수 있어요.");
    return Array.from({ length: last - first + 1 }, (_: unknown, index: number): number => first + index);
  });
  const pages: readonly number[] = [...new Set(entries.flat())].sort((left: number, right: number): number => left - right);
  if (pages.length > extractionLimits.pagesPerSelection) throw new RangeError("한 번에 최대 20페이지를 선택할 수 있어요.");
  return pages;
}

/** 목차와 본문을 겹치지 않게 묶고 원본 식별자를 선택 전체에 고정합니다. */
export function buildSelection(file: MaterialFileReference, contents: string, study: string): SelectionInput {
  const toc: readonly number[] = contents.trim() === "" ? [] : parsePageSelection(contents, file.pages);
  const body: readonly number[] = study.trim() === "" ? [] : parsePageSelection(study, file.pages);
  if (toc.some((page: number): boolean => body.includes(page))) throw new RangeError("같은 페이지를 목차와 본문에 동시에 선택할 수 없어요.");
  const pages: readonly SelectedPage[] = [...toc.map((filePage): SelectedPage => ({ filePage, purpose: "contents" })), ...body.map((filePage): SelectedPage => ({ filePage, purpose: "study" }))].sort((a: SelectedPage, b: SelectedPage): number => a.filePage - b.filePage);
  return validateSelection({ materialId: file.materialId, originalVersion: file.objectVersion, originalHash: file.sha256, pages }, file);
}

/** 서버가 조회한 원본과 비교하며 클라이언트의 페이지 수나 객체 키는 받지 않습니다. */
export function validateSelection(value: unknown, file: MaterialFileReference): SelectionInput {
  const input = selectionInput.parse(value);
  if (input.materialId !== file.materialId || input.originalVersion !== file.objectVersion || input.originalHash !== file.sha256) throw new Error("선택한 원본 버전이 달라요. 자료 목록에서 다시 선택해 주세요.");
  if (new Set(input.pages.map((page): number => page.filePage)).size !== input.pages.length || input.pages.some((page): boolean => page.filePage > file.pages)) throw new RangeError("선택 페이지가 중복되거나 원본 범위를 벗어났어요.");
  return { ...input, pages: [...input.pages].sort((a: SelectedPage, b: SelectedPage): number => a.filePage - b.filePage) };
}

export function requireSelectedPage(binding: SelectionBinding, jobId: string, revision: number, filePage: number): SelectedPage {
  if (binding.jobId !== jobId || binding.revision !== revision) throw new Error("선택 작업 버전이 달라요. 현재 작업을 다시 불러와 주세요.");
  const page: SelectedPage | undefined = binding.selection.pages.find((item: SelectedPage): boolean => item.filePage === filePage);
  if (page === undefined) throw new RangeError("선택하지 않은 페이지는 처리할 수 없어요.");
  return page;
}
