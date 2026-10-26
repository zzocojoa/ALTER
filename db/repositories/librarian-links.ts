import { requireBibliographyEvidence } from "../../lib/librarian/bibliography.ts";
import { advisorState } from "../../lib/advisor/contracts.ts";
import { contentHash, domainFailure, recordId } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { candidateSnapshot, confirmedUnit, linkedMaterial, linkInput, requireDistinct, sourceExcerpt } from "../../lib/librarian/contracts.ts";
import type { CandidateSnapshot, ConfirmedUnit, LinkedMaterial, LinkInput, PrerequisiteState, SourceExcerpt, UnitProgress } from "../../lib/librarian/contracts.ts";
import { knownSourceAccessIssue, sourceRecheckAction } from "../../lib/librarian/issues.ts";
import { resolveExtractionSource } from "../../lib/extraction/source-server.ts";
import { getRegisteredMaterial } from "../../lib/materials/download.ts";
import { headMaterialObject } from "../../lib/materials/object.ts";
import { executeAtomic, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { requireMaterialVisibility } from "./material-access.ts";
import { advisorRecordId } from "./advisor.ts";

/** 확정 시의 평가 계약과 단원 순서를 사용하며 새 계획이 있으면 이전 연결을 거부합니다. */
export async function readConfirmedUnit(db: D1Database, owner: SiteIdentity, planVersionId: string, unitId: string): Promise<ConfirmedUnit> {
  recordId.parse(planVersionId); recordId.parse(unitId);
  const row = await readStorage("librarian.unit", () => db.prepare("SELECT p.id,p.plan_id,p.course_id,p.ordinal,u.version AS unit_version,a.state FROM plan_versions p JOIN units u ON u.owner_id=p.owner_id AND u.course_id=p.course_id JOIN advisor_sessions a ON a.owner_id=p.owner_id AND a.id=p.plan_id WHERE p.owner_id=? AND p.id=? AND u.id=? AND p.ordinal=(SELECT MAX(ordinal) FROM plan_versions WHERE owner_id=p.owner_id AND plan_id=p.plan_id)").bind(owner.userId, planVersionId, unitId).first<{ id: string; plan_id: string; course_id: string; ordinal: number; unit_version: number; state: string }>());
  if (!row) throw domainFailure("reference_conflict", "librarian.confirmed-current-plan-required", null);
  const advisor = advisorState.parse(JSON.parse(row.state));
  if (advisor.phase !== "confirmed" || advisor.confirmedPlanVersionId !== planVersionId || !advisor.draft) throw domainFailure("reference_conflict", "librarian.unconfirmed-plan", null);
  const known = await Promise.all(advisor.draft.units.map(async (unit) => ({ unit, id: await advisorRecordId(`${row.plan_id}:unit:${unit.key}`) })));
  const item = known.find((candidate): boolean => candidate.id === unitId);
  if (!item) throw domainFailure("reference_conflict", "librarian.unit-not-in-plan", null);
  return confirmedUnit.parse({ planId: row.plan_id, planVersionId, planOrdinal: row.ordinal, courseId: row.course_id, unitId, unitVersion: row.unit_version, title: item.unit.title, objective: item.unit.objective, selfExplanationCriterion: item.unit.selfExplanationCriterion, newConditionCriterion: item.unit.newConditionCriterion, prerequisiteUnitIds: known.filter((candidate): boolean => item.unit.prerequisiteKeys.includes(candidate.unit.key)).map((candidate): string => candidate.id), assessment: advisor.assessment, selfReportedLevel: advisor.conditions.selfReportedLevel });
}
export async function listConfirmedUnits(db: D1Database, owner: SiteIdentity): Promise<readonly ConfirmedUnit[]> {
  const rows = await readStorage("librarian.units", () => db.prepare("SELECT p.id AS plan_id,u.id AS unit_id FROM plan_versions p JOIN units u ON u.owner_id=p.owner_id AND u.course_id=p.course_id JOIN advisor_sessions a ON a.owner_id=p.owner_id AND a.id=p.plan_id WHERE p.owner_id=? AND json_extract(a.state,'$.phase')='confirmed' AND json_extract(a.state,'$.confirmedPlanVersionId')=p.id AND p.ordinal=(SELECT MAX(ordinal) FROM plan_versions WHERE owner_id=p.owner_id AND plan_id=p.plan_id) ORDER BY p.confirmed_at DESC,u.ordinal LIMIT 120").bind(owner.userId).all<{ plan_id: string; unit_id: string }>());
  return Promise.all(rows.results.map((row) => readConfirmedUnit(db, owner, row.plan_id, row.unit_id)));
}
export async function readPrerequisiteStates(db: D1Database, owner: SiteIdentity, ids: readonly string[]): Promise<readonly PrerequisiteState[]> {
  return Promise.all(ids.map(async (unitId): Promise<PrerequisiteState> => {
    const row = await readStorage("librarian.prerequisite", () => db.prepare("SELECT c.id,c.progress,c.performance FROM learning_results l JOIN confirmed_results c ON c.owner_id=l.owner_id AND c.id=l.current_version_id WHERE l.owner_id=? AND l.unit_id=? ORDER BY c.confirmed_at DESC,c.id DESC LIMIT 1").bind(owner.userId, unitId).first<{ id: string; progress: PrerequisiteState["progress"]; performance: string }>());
    return { unitId: recordId.parse(unitId), status: row === null || row.performance === "미확인" ? "unverified" : row.progress === "완료" && ["독립 수행", "지연 재현"].includes(row.performance) ? "met" : "unmet", evidenceId: row === null ? null : recordId.parse(row.id), progress: row?.progress ?? "미시작", delayedRecall: row?.performance === "지연 재현" ? "확인" : "미확인" };
  }));
}
export function currentUnitGuard(db: D1Database, owner: SiteIdentity, unit: ConfirmedUnit, requestId: string, step: number): D1PreparedStatement {
  return requireInBatch(db, owner.userId, requestId, step, "EXISTS(SELECT 1 FROM plan_versions p JOIN units u ON u.owner_id=p.owner_id AND u.course_id=p.course_id WHERE p.owner_id=? AND p.id=? AND p.ordinal=? AND u.id=? AND u.version=? AND NOT EXISTS(SELECT 1 FROM plan_versions n WHERE n.owner_id=p.owner_id AND n.plan_id=p.plan_id AND n.ordinal>p.ordinal))", [owner.userId, unit.planVersionId, unit.planOrdinal, unit.unitId, unit.unitVersion]);
}
/** 원본 교체·판독 정정·선택 변경이 배치 직전 발생해도 이전 출처를 저장하지 않습니다. */
export function currentSourceGuard(db: D1Database, owner: SiteIdentity, source: SourceExcerpt, requestId: string, step: number): D1PreparedStatement {
  return requireInBatch(db, owner.userId, requestId, step, "EXISTS(SELECT 1 FROM source_references s JOIN extraction_sources e ON e.owner_id=s.owner_id AND e.source_id=s.id JOIN extraction_results r ON r.owner_id=e.owner_id AND r.id=e.result_id JOIN extraction_pages p ON p.owner_id=r.owner_id AND p.id=r.page_id JOIN extraction_jobs j ON j.owner_id=p.owner_id AND j.id=p.job_id JOIN extraction_confirmations c ON c.owner_id=e.owner_id AND c.result_id=e.result_id AND c.segment_id=e.segment_id JOIN material_files f ON f.owner_id=s.owner_id AND f.material_id=s.material_id JOIN material_transfers t ON t.owner_id=f.owner_id AND t.id=f.transfer_id JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE s.owner_id=? AND s.id=? AND s.page_id=? AND s.evidence=? AND p.result_id=r.id AND p.state='complete' AND j.version=p.selection_revision AND j.upload_id=s.upload_id AND t.id=s.upload_id AND t.state='registered' AND u.state='verified' AND t.object_version=r.original_version AND t.actual_hash=r.original_hash)", [owner.userId, source.id, source.pageId, source.evidence]);
}
export async function getMaterialLink(db: D1Database, owner: SiteIdentity, id: string): Promise<LinkedMaterial> {
  recordId.parse(id);
  const row = await readStorage("librarian.link", () => db.prepare("SELECT content FROM librarian_links WHERE owner_id=? AND id=?").bind(owner.userId, id).first<{ content: string }>());
  if (!row) throw domainFailure("reference_conflict", "librarian.link-owner", null);
  return linkedMaterial.parse(JSON.parse(row.content));
}
export async function listMaterialLinks(db: D1Database, owner: SiteIdentity, planVersionId: string, unitId: string): Promise<readonly LinkedMaterial[]> {
  await readConfirmedUnit(db, owner, planVersionId, unitId);
  const rows = await readStorage("librarian.links", () => db.prepare("SELECT content FROM librarian_links WHERE owner_id=? AND plan_version_id=? AND unit_id=? ORDER BY rowid DESC LIMIT 50").bind(owner.userId, planVersionId, unitId).all<{ content: string }>());
  return rows.results.map((row): LinkedMaterial => linkedMaterial.parse(JSON.parse(row.content)));
}
async function inspectAvailableMaterialLink(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, link: LinkedMaterial): Promise<CandidateSnapshot> {
  const transfer = await getRegisteredMaterial(db, owner, link.materialId);
  await headMaterialObject(bucket, transfer);
  const judgments = await Promise.all(link.sourceRefIds.map((id) => resolveExtractionSource(db, bucket, owner, id)));
  const sources: SourceExcerpt[] = judgments.flatMap((judgment): SourceExcerpt[] => judgment.valid ? [sourceExcerpt.parse(judgment.source)] : []);
  if (sources.some((source): boolean => source.materialId !== link.materialId)) throw domainFailure("reference_conflict", "librarian.source-material-mismatch", null);
  const invalid = judgments.find((judgment): boolean => !judgment.valid);
  const reason: string | null = link.sourceRefIds.length === 0 ? "본문을 원본과 대조하고 확인한 구간을 연결해 주세요." : invalid && !invalid.valid ? sourceRecheckAction(invalid.reason) : JSON.stringify(transfer.metadata) !== JSON.stringify(link.metadata) ? "원본 판본 또는 메타데이터가 바뀌었어요." : null;
  const data = { link, valid: reason === null, reason, sources };
  return candidateSnapshot.parse({ ...data, fingerprint: await contentHash(data) });
}
export async function inspectMaterialLink(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, link: LinkedMaterial): Promise<CandidateSnapshot> {
  try { return await inspectAvailableMaterialLink(db, bucket, owner, link); }
  catch (error: unknown) {
    const reason: string | null = knownSourceAccessIssue(error);
    if (reason === null) throw error;
    const data = { link, valid: false, reason, sources: [] };
    return candidateSnapshot.parse({ ...data, fingerprint: await contentHash(data) });
  }
}
export async function createMaterialLink(db: D1Database, bucket: R2Bucket, cmd: Command, value: LinkInput): Promise<Receipt> {
  await requireMaterialVisibility(db, cmd.owner);
  const input: LinkInput = linkInput.parse(value); requireDistinct(input.sourceRefIds, "librarian.duplicate-source");
  if (cmd.expectedVersion !== 1) throw domainFailure("version_conflict", "librarian.link-create-version", null);
  const unit = await readConfirmedUnit(db, cmd.owner, input.planVersionId, input.unitId);
  const transfer = await getRegisteredMaterial(db, cmd.owner, input.materialId);
  const link: LinkedMaterial = linkedMaterial.parse({ ...input, metadata: transfer.metadata, version: 1, createdAt: Date.now() });
  const inspected = await inspectMaterialLink(db, bucket, cmd.owner, link);
  if (input.sourceRefIds.length > 0 && !inspected.valid) throw domainFailure("reference_conflict", "librarian.source-recheck", null);
  requireBibliographyEvidence(link, inspected.sources);
  return executeAtomic(db, cmd, "librarian.link", input, input.id, 1, (requestId) => [
    currentUnitGuard(db, cmd.owner, unit, requestId, 0), ...inspected.sources.map((source, index) => currentSourceGuard(db, cmd.owner, source, requestId, index + 1)),
    db.prepare("INSERT INTO librarian_links VALUES (?,?,?,?,?,?)").bind(cmd.owner.userId, input.id, input.planVersionId, input.unitId, input.materialId, JSON.stringify(link)),
    ...input.sourceRefIds.map((sourceId) => db.prepare("INSERT INTO librarian_link_sources VALUES (?,?,?)").bind(cmd.owner.userId, input.id, sourceId)),
  ]);
}

/** 확정 결과의 출처만 완료 구간으로 읽으며 진단·초안 답변을 진도로 승격하지 않습니다. */
export async function readUnitProgress(db: D1Database, owner: SiteIdentity, unitId: string): Promise<UnitProgress> {
  const current = (await readPrerequisiteStates(db, owner, [unitId]))[0];
  const rows = await readStorage("librarian.completed-sources", () => db.prepare("SELECT DISTINCT q.source_ref_id AS id FROM learning_results l JOIN confirmed_results c ON c.owner_id=l.owner_id AND c.id=l.current_version_id JOIN answers a ON a.owner_id=c.owner_id AND a.id=c.answer_id JOIN attempts t ON t.owner_id=a.owner_id AND t.id=a.attempt_id JOIN questions q ON q.owner_id=t.owner_id AND q.id=t.question_id WHERE l.owner_id=? AND l.unit_id=? AND c.progress='완료' AND c.performance IN ('독립 수행','지연 재현') AND q.source_ref_id IS NOT NULL").bind(owner.userId, unitId).all<{ id: string }>());
  return { current, completedSourceIds: rows.results.map((row) => recordId.parse(row.id)) };
}
