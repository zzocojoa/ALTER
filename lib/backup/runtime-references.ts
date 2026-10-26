import type { BackupTableName } from "./catalog.ts";
import type { BackupRow } from "./contracts.ts";
import { advisorState } from "../advisor/contracts.ts";
import { tutorState } from "../tutor/contracts.ts";
import { scopeState, linkedMaterial } from "../librarian/contracts.ts";
import type { SourceExcerpt, ConfirmedUnit } from "../librarian/contracts.ts";
import { backupFailure } from "./contracts.ts";

function requireState(condition: boolean, location: string): void { if (!condition) throw backupFailure("invalid-field", location); }

type RuntimeReference = Readonly<{ table: BackupTableName; id: string; field: string }>;
function reference(table: BackupTableName, id: string, field: string): RuntimeReference { return { table, id, field }; }
function sourceReferences(source: SourceExcerpt): readonly RuntimeReference[] {
  return [reference("source_references", source.id, "source.id"), reference("materials", source.materialId, "source.materialId"), reference("uploads", source.uploadId, "source.uploadId"), reference("material_pages", source.pageId, "source.pageId")];
}
function unitReferences(unit: ConfirmedUnit): readonly RuntimeReference[] {
  return [reference("plans", unit.planId, "unit.planId"), reference("plan_versions", unit.planVersionId, "unit.planVersionId"), reference("courses", unit.courseId, "unit.courseId"), reference("units", unit.unitId, "unit.unitId"), ...unit.prerequisiteUnitIds.map(id => reference("units", id, "unit.prerequisiteUnitIds"))];
}
/** JSON 안의 학습 출처도 실제 행에 연결합니다. 과거 버전의 본문을 현재 본문으로 덮어 맞추지 않습니다. */
export function runtimeReferences(table: string, row: BackupRow, location: string): readonly RuntimeReference[] {
  if (table === "advisor_sessions") {
    const state = advisorState.parse(JSON.parse(String(row.state)));
    requireState(state.id === row.id && state.version === row.version, location);
    return state.confirmedPlanVersionId === null ? [] : [reference("plan_versions", state.confirmedPlanVersionId, "confirmedPlanVersionId")];
  }
  if (table === "librarian_links") {
    const link = linkedMaterial.parse(JSON.parse(String(row.content)));
    requireState(link.id === row.id && link.planVersionId === row.plan_version_id && link.unitId === row.unit_id && link.materialId === row.material_id, location);
    return [...link.sourceRefIds.map(id => reference("source_references", id, "sourceRefIds")), ...(link.bibliography.evidenceSourceId === null ? [] : [reference("source_references", link.bibliography.evidenceSourceId, "bibliography.evidenceSourceId")])];
  }
  if (table === "study_scopes") {
    const state = scopeState.parse(JSON.parse(String(row.state)));
    requireState(state.input.id === row.id && state.version === row.version && state.input.planVersionId === row.plan_version_id && state.input.unitId === row.unit_id, location);
    return [...unitReferences(state.unit), ...state.input.linkIds.map(id => reference("librarian_links", id, "input.linkIds")), ...state.candidates.flatMap(candidate => [reference("librarian_links", candidate.link.id, "candidate.link"), ...candidate.sources.flatMap(sourceReferences)]), ...(state.bundle?.sources.flatMap(sourceReferences) ?? []), ...[state.progress.current, ...state.prerequisites].flatMap(item => item.evidenceId === null ? [] : [reference("confirmed_results", item.evidenceId, "prerequisite.evidenceId")])];
  }
  if (table === "tutor_sessions") {
    const state = tutorState.parse(JSON.parse(String(row.state)));
    requireState(state.id === row.id && state.version === row.version && state.start.scopeId === row.scope_id, location);
    return [...unitReferences(state.start.bundle.unit), ...state.start.bundle.sources.flatMap(sourceReferences), ...state.questions.flatMap(question => [reference("questions", question.id, "questions.id"), reference("attempts", question.attemptId, "questions.attemptId"), ...question.sourceRefIds.map(id => reference("source_references", id, "questions.sourceRefIds"))]), ...state.answers.flatMap(answer => [reference("answers", answer.id, "answers.id"), ...answer.fileIds.map(id => reference("materials", id, "answers.fileIds"))]), ...state.help.map(help => reference("help_events", help.id, "help.id")), ...state.draft.fileIds.map(id => reference("materials", id, "draft.fileIds")), ...(state.start.latest === null ? [] : [reference("confirmed_results", state.start.latest.resultVersionId, "start.latest")]), ...state.start.reviews.map(review => reference("review_items", review.id, "start.reviews"))];
  }
  return [];
}
