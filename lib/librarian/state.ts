import { domainFailure } from "../domain/contracts.ts";
import { scopeState, scopeInput, tutorBundle, requireDistinct } from "./contracts.ts";
import type { CandidateSnapshot, ConfirmedUnit, LibrarianEvaluation, PrerequisiteState, ScopeInput, ScopeState, TutorBundle, UnitProgress } from "./contracts.ts";
import { proposeStudyRange } from "./range.ts";
import { validateLibrarianEvaluation } from "./evaluation.ts";

export function initialStudyScope(value: ScopeInput, unit: ConfirmedUnit, candidates: readonly CandidateSnapshot[], prerequisites: readonly PrerequisiteState[], progress: UnitProgress): ScopeState {
  const input: ScopeInput = scopeInput.parse(value);
  requireDistinct(input.linkIds, "librarian.scope-duplicate-links");
  if (input.planVersionId !== unit.planVersionId || input.unitId !== unit.unitId || input.linkIds.length !== candidates.length || candidates.some((item): boolean => !input.linkIds.includes(item.link.id) || item.link.planVersionId !== input.planVersionId || item.link.unitId !== input.unitId)) throw domainFailure("reference_conflict", "librarian.scope-link-unit", null);
  return scopeState.parse({ input, version: 1, unit, candidates, prerequisites, progress, phase: "linked", pendingKey: null, evaluation: null, selection: null, bundle: null });
}
export function beginScopeEvaluation(state: ScopeState): ScopeState {
  if (state.phase !== "linked" || state.pendingKey !== null) throw domainFailure("version_conflict", "librarian.begin-phase", null);
  if (!state.candidates.some((candidate): boolean => candidate.valid && candidate.link.bibliography.checked)) throw domainFailure("reference_conflict", "librarian.confirm-source-before-ai", null);
  return scopeState.parse({ ...state, version: state.version + 1, phase: "evaluating", pendingKey: `librarian:${state.input.id}:${state.version}` });
}
function buildTutorBundle(state: ScopeState, evaluation: LibrarianEvaluation, selectedIds: readonly string[], plannedMinutes: number): TutorBundle {
  const candidates = state.candidates.filter((candidate): boolean => selectedIds.includes(candidate.link.id));
  const chosen = evaluation.candidates.filter((candidate): boolean => selectedIds.includes(candidate.linkId));
  const question = chosen.find((candidate): boolean => candidate.coverage.includes("explanation") && candidate.question !== null)?.question;
  const exercise = chosen.find((candidate): boolean => candidate.coverage.includes("practice") && candidate.exercise !== null)?.exercise;
  if (!question || !exercise || candidates.some((candidate): boolean => !candidate.valid)) throw domainFailure("reference_conflict", "librarian.tutor-elements", null);
  const allSources = candidates.flatMap((candidate) => candidate.sources);
  const sources = allSources.filter((source, index): boolean => allSources.findIndex((known): boolean => known.id === source.id) === index);
  return tutorBundle.parse({ unit: state.unit, date: state.input.date, availableMinutes: state.input.availableMinutes, plannedMinutes, selectedLinkIds: selectedIds, sources, question, exercise, assessment: state.unit.assessment });
}
/** 비교 결과를 제안으로 저장하며 사용자 검토 전에는 확정된 Tutor 입력이 아닙니다. */
export function finishScopeEvaluation(state: ScopeState, evaluation: LibrarianEvaluation): ScopeState {
  if (state.phase !== "evaluating" || !state.pendingKey) throw domainFailure("version_conflict", "librarian.finish-phase", null);
  validateLibrarianEvaluation(evaluation, state.unit, state.candidates);
  const selection = proposeStudyRange(state.input, state.unit, state.candidates, evaluation, state.prerequisites, state.progress);
  const bundle: TutorBundle | null = selection.status === "ready" ? buildTutorBundle(state, evaluation, selection.selectedIds, selection.minutes) : null;
  return scopeState.parse({ ...state, version: state.version + 1, phase: "proposed", pendingKey: null, evaluation, selection, bundle });
}
export function confirmStudyScope(state: ScopeState): ScopeState {
  if (state.phase !== "proposed" || state.selection?.status !== "ready" || !state.bundle || !state.evaluation || state.pendingKey !== null) throw domainFailure("version_conflict", "librarian.confirm-proposal-required", null);
  return scopeState.parse({ ...state, version: state.version + 1, phase: "confirmed" });
}
