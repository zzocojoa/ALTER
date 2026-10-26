import { domainFailure } from "../domain/contracts.ts";
import type { CandidateEvaluation, CandidateSnapshot, ConfirmedUnit, CoverageRole, LibrarianEvaluation, SelectionResult } from "./contracts.ts";
import { requireDistinct } from "./contracts.ts";
import { eligibleEvaluation, validateLibrarianEvaluation } from "./evaluation.ts";

type RecordId = CandidateSnapshot["link"]["id"];
export const REQUIRED_ROLES: readonly CoverageRole[] = ["explanation", "example", "practice"];
export type MaterialSet = Readonly<{ ids: readonly RecordId[]; readingMinutes: number }>;
export type MaterialSets = Readonly<{ sets: readonly MaterialSet[]; missingRoles: readonly CoverageRole[]; eligible: readonly CandidateEvaluation[] }>;

/** 최대 12개 후보의 전체 조합을 비교해 자료 수와 읽기 시간이 작은 순서로 정렬합니다. */
export function coveringMaterialSets(unit: ConfirmedUnit, candidates: readonly CandidateSnapshot[], evaluation: LibrarianEvaluation): MaterialSets {
  if (candidates.length < 1 || candidates.length > 12) throw domainFailure("limit_exceeded", "librarian.candidate-count", null);
  requireDistinct(candidates.map((item): string => item.link.id), "librarian.candidate-duplicate");
  validateLibrarianEvaluation(evaluation, unit, candidates);
  const eligible: readonly CandidateEvaluation[] = evaluation.candidates.filter((item): boolean => {
    const candidate = candidates.find((known): boolean => known.link.id === item.linkId);
    return candidate !== undefined && eligibleEvaluation(item, candidate);
  });
  const missingRoles: readonly CoverageRole[] = REQUIRED_ROLES.filter((role): boolean => !eligible.some((item): boolean => item.coverage.includes(role)));
  const sets: MaterialSet[] = Array.from({ length: 2 ** eligible.length - 1 }, (_, index): readonly CandidateEvaluation[] => eligible.filter((_, bit): boolean => ((index + 1) & (1 << bit)) !== 0))
    .filter((items): boolean => REQUIRED_ROLES.every((role): boolean => items.some((item): boolean => item.coverage.includes(role))))
    .map((items): MaterialSet => ({ ids: items.map((item): RecordId => item.linkId).sort(), readingMinutes: candidates.filter((item): boolean => items.some((choice): boolean => choice.linkId === item.link.id)).reduce((sum, item): number => sum + item.link.readingMinutes, 0) }))
    .sort((a, b): number => a.ids.length - b.ids.length || a.readingMinutes - b.readingMinutes || a.ids.join().localeCompare(b.ids.join()));
  return { sets, missingRoles, eligible };
}
const roleNames: Readonly<Record<CoverageRole, string>> = { explanation: "설명", example: "예제", practice: "직접 수행" };
const judgmentNames = { supported: "근거 있음", unsuitable: "부적합", unverified: "미확인" } as const;
export function selectionDecisions(candidates: readonly CandidateSnapshot[], evaluation: LibrarianEvaluation, ids: readonly RecordId[]): SelectionResult["decisions"] {
  return candidates.map((candidate) => {
    const item = evaluation.candidates.find((known): boolean => known.linkId === candidate.link.id);
    if (!item) throw domainFailure("reference_conflict", "librarian.missing-evaluation", null);
    const alternatives: RecordId[] = evaluation.candidates.filter((other): boolean => ids.includes(other.linkId) && other.linkId !== item.linkId && other.coverage.some((role): boolean => item.coverage.includes(role))).map((other): RecordId => other.linkId);
    const selected: boolean = ids.includes(candidate.link.id);
    const reason: string = selected ? `목표에 필요한 ${item.coverage.map((role): string => roleNames[role]).join("·")} 근거를 제공해 선정했어요.` : !candidate.valid ? candidate.reason ?? "본문 구간을 다시 확인해 주세요." : !eligibleEvaluation(item, candidate) ? `확인 보류: 신뢰성 ${judgmentNames[item.reliability.judgment]}, 난도 ${judgmentNames[item.difficulty.judgment]}, 목표 적합성 ${judgmentNames[item.relevance.judgment]}. 각 축의 근거를 확인해 주세요.` : ids.length === 0 ? "목표 전체를 충족하는 자료 집합이 없어 선정을 보류했어요." : "선정 자료로 목표와 필요한 역할을 충족해 중복을 줄였어요. 자료 수가 같으면 예상 읽기 시간이 짧은 조합을 선택해요.";
    return { linkId: candidate.link.id, selected, reason, alternativeIds: alternatives };
  });
}
/** 일부 목표만 충족하는 후보로 부족한 역할을 임의로 채우지 않습니다. */
export function minimumMaterialSet(unit: ConfirmedUnit, candidates: readonly CandidateSnapshot[], evaluation: LibrarianEvaluation): SelectionResult {
  const options: MaterialSets = coveringMaterialSets(unit, candidates, evaluation);
  const chosen: MaterialSet | undefined = options.sets[0];
  const ids: readonly RecordId[] = chosen?.ids ?? [];
  return { status: chosen ? "ready" : "needs-material", selectedIds: [...ids], missingRoles: [...options.missingRoles], minutes: chosen?.readingMinutes ?? 0, requiredMinutes: chosen?.readingMinutes ?? 0, reasons: chosen ? [] : ["설명·예제·직접 수행의 근거를 모두 갖춘 자료가 필요해요."], decisions: selectionDecisions(candidates, evaluation, ids) };
}
