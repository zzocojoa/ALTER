import { domainFailure } from "../domain/contracts.ts";
import { scopeInput } from "./contracts.ts";
import type { CandidateSnapshot, ConfirmedUnit, LibrarianEvaluation, PrerequisiteState, ScopeInput, SelectionResult, UnitProgress } from "./contracts.ts";
import { coveringMaterialSets, REQUIRED_ROLES, selectionDecisions } from "./selection.ts";
import { validateLibrarianEvaluation } from "./evaluation.ts";

export type UnitOption = Readonly<{ unit: ConfirmedUnit; progress: PrerequisiteState; prerequisites: readonly PrerequisiteState[]; available: boolean }>;
/** 진행 중인 단원을 우선하고 같은 상태에서는 확정 계획의 원래 순서를 유지합니다. */
export function orderUnitOptions(units: readonly ConfirmedUnit[], states: readonly PrerequisiteState[]): readonly UnitOption[] {
  return units.map((unit): UnitOption => {
    const progress = states.find((item): boolean => item.unitId === unit.unitId);
    const prerequisites = unit.prerequisiteUnitIds.map((id): PrerequisiteState => {
      const value = states.find((item): boolean => item.unitId === id);
      if (!value) throw domainFailure("reference_conflict", "librarian.missing-prerequisite-state", null);
      return value;
    });
    if (!progress) throw domainFailure("reference_conflict", "librarian.missing-unit-progress", null);
    return { unit, progress, prerequisites, available: progress.progress !== "완료" && prerequisites.every((item): boolean => item.status === "met") };
  }).sort((a, b): number => Number(b.available) - Number(a.available) || Number(b.progress.progress === "진행 중") - Number(a.progress.progress === "진행 중"));
}
/** 선택 구간은 분할하지 않습니다. 이미 완료한 구간은 사용자가 다시 범위를 지정해야 합니다. */
export function proposeStudyRange(value: ScopeInput, unit: ConfirmedUnit, candidates: readonly CandidateSnapshot[], evaluation: LibrarianEvaluation, prerequisites: readonly PrerequisiteState[], progress: UnitProgress): SelectionResult {
  const input: ScopeInput = scopeInput.parse(value);
  validateLibrarianEvaluation(evaluation, unit, candidates);
  if (input.unitId !== unit.unitId || input.planVersionId !== unit.planVersionId || progress.current.unitId !== unit.unitId || input.linkIds.length !== candidates.length || candidates.some((candidate): boolean => !input.linkIds.includes(candidate.link.id))) throw domainFailure("reference_conflict", "librarian.range-input", null);
  if (prerequisites.length !== unit.prerequisiteUnitIds.length || unit.prerequisiteUnitIds.some((id): boolean => !prerequisites.some((item): boolean => item.unitId === id))) throw domainFailure("reference_conflict", "librarian.range-prerequisites", null);
  const excluded: readonly CandidateSnapshot[] = candidates.filter((candidate): boolean => candidate.sources.some((source): boolean => progress.completedSourceIds.includes(source.id)));
  const available: readonly CandidateSnapshot[] = candidates.filter((candidate): boolean => !excluded.includes(candidate));
  const availableEvaluation: LibrarianEvaluation = { ...evaluation, candidates: evaluation.candidates.filter((item): boolean => available.some((candidate): boolean => candidate.link.id === item.linkId)) };
  const options = available.length > 0 ? coveringMaterialSets(unit, available, availableEvaluation) : { sets: [], missingRoles: REQUIRED_ROLES, eligible: [] };
  const workMinutes: number = input.questionMinutes + input.practiceMinutes;
  const chosen = options.sets.find((set): boolean => set.readingMinutes + workMinutes <= input.availableMinutes);
  const requiredMinutes: number = options.sets.length > 0 ? Math.min(...options.sets.map((set): number => set.readingMinutes + workMinutes)) : 0;
  const unmet = prerequisites.filter((item): boolean => item.status !== "met");
  const status: SelectionResult["status"] = progress.current.progress === "완료" ? "needs-range" : unmet.length > 0 ? "needs-prerequisite" : options.sets.length === 0 ? excluded.length > 0 ? "needs-range" : "needs-material" : !chosen ? "needs-time" : "ready";
  const selectedIds = status === "ready" && chosen ? [...chosen.ids] : [];
  const reasons: string[] = [
    ...(progress.current.progress === "완료" ? ["완료한 단원이에요. 다음 단원 또는 별도 복습을 선택해 주세요."] : []),
    ...unmet.map((item): string => `선행 단원 ${item.unitId}: ${item.status === "unmet" ? "충족하지 못함" : "수행 근거 미확인"}. 실제 수행 결과를 확인해 주세요.`),
    ...(options.sets.length === 0 ? ["아직 공부하지 않은 구간에서 설명·예제·직접 수행 근거를 모두 연결해 주세요."] : []),
    ...(options.sets.length > 0 && !chosen ? [`읽기·질문·직접 수행에 최소 ${requiredMinutes}분이 필요해요. 시간을 늘리거나 더 작은 확인 구간을 직접 선택해 주세요.`] : []),
  ];
  const decisions = selectionDecisions(candidates, evaluation, selectedIds).map((decision) => excluded.some((candidate): boolean => candidate.link.id === decision.linkId) ? { ...decision, reason: "완료한 구간을 포함해 제외했어요. 본문을 자동으로 자르지 않으므로 남은 구간을 직접 선택해 주세요.", alternativeIds: [] } : decision);
  return { status, selectedIds, missingRoles: [...options.missingRoles], minutes: chosen && status === "ready" ? chosen.readingMinutes + workMinutes : 0, requiredMinutes, reasons, decisions };
}
