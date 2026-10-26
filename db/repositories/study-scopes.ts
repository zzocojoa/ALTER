import { z } from "zod";
import { contentHash, domainFailure, recordId, version } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { scopeState } from "../../lib/librarian/contracts.ts";
import type { ScopeInput, ScopeState, LibrarianEvaluation, TutorBundle } from "../../lib/librarian/contracts.ts";
import { beginScopeEvaluation, confirmStudyScope, finishScopeEvaluation, initialStudyScope } from "../../lib/librarian/state.ts";
import { currentSourceGuard, currentUnitGuard, getMaterialLink, inspectMaterialLink, readConfirmedUnit, readPrerequisiteStates, readUnitProgress } from "./librarian-links.ts";
import { executeAtomic, guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { requireMaterialVisibility } from "./material-access.ts";

type ScopeRow = Readonly<{ state: string }>;
export async function getStudyScope(db: D1Database, owner: SiteIdentity, id: string): Promise<ScopeState> {
  recordId.parse(id); await requireMaterialVisibility(db, owner);
  const row = await readStorage("librarian.scope-get", () => db.prepare("SELECT state FROM study_scopes WHERE owner_id=? AND id=?").bind(owner.userId, id).first<ScopeRow>());
  if (!row) throw domainFailure("reference_conflict", "librarian.scope-owner", null);
  return scopeState.parse(JSON.parse(row.state));
}
export async function listStudyScopes(db: D1Database, owner: SiteIdentity): Promise<readonly ScopeState[]> {
  await requireMaterialVisibility(db, owner);
  const rows = await readStorage("librarian.scope-list", () => db.prepare("SELECT state FROM study_scopes WHERE owner_id=? ORDER BY rowid DESC LIMIT 30").bind(owner.userId).all<ScopeRow>());
  return rows.results.map((row): ScopeState => scopeState.parse(JSON.parse(row.state)));
}
async function previousScope(db: D1Database, cmd: Command, id: string): Promise<ScopeState> {
  recordId.parse(id); version.parse(cmd.expectedVersion);
  const row = await readStorage("librarian.scope-version", () => db.prepare("SELECT json_extract(content,'$.state') AS state FROM scope_events WHERE owner_id=? AND scope_id=? AND version=?").bind(cmd.owner.userId, id, cmd.expectedVersion).first<ScopeRow>());
  if (!row) throw domainFailure("version_conflict", "librarian.scope-version", null);
  return scopeState.parse(JSON.parse(row.state));
}
/** 현재 원문·계획·확정 결과를 저장 당시 상태와 대조합니다. */
export async function requireCurrentScope(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, state: ScopeState): Promise<void> {
  await requireMaterialVisibility(db, owner);
  const unit = await readConfirmedUnit(db, owner, state.input.planVersionId, state.input.unitId);
  const candidates = await Promise.all(state.candidates.map((candidate) => inspectMaterialLink(db, bucket, owner, candidate.link)));
  const prerequisites = await readPrerequisiteStates(db, owner, unit.prerequisiteUnitIds);
  const progress = await readUnitProgress(db, owner, unit.unitId);
  if (await contentHash({ unit, candidates, prerequisites, progress }) !== await contentHash({ unit: state.unit, candidates: state.candidates, prerequisites: state.prerequisites, progress: state.progress })) throw domainFailure("reference_conflict", "librarian.scope-source-plan-progress-changed-reselect", null);
}
function guards(db: D1Database, owner: SiteIdentity, state: ScopeState, requestId: string): readonly D1PreparedStatement[] {
  const sources = state.candidates.filter((candidate): boolean => candidate.valid).flatMap((candidate) => candidate.sources);
  const results = [state.progress.current, ...state.prerequisites];
  return [currentUnitGuard(db, owner, state.unit, requestId, 1), ...sources.map((source, index) => currentSourceGuard(db, owner, source, requestId, index + 2)),
    ...results.map((result, index) => requireInBatch(db, owner.userId, requestId, index + sources.length + 2, "(SELECT current_version_id FROM learning_results WHERE owner_id=? AND unit_id=?) IS ?", [owner.userId, result.unitId, result.evidenceId])),
    requireInBatch(db, owner.userId, requestId, sources.length + results.length + 2, "NOT EXISTS(SELECT 1 FROM attempts WHERE owner_id=? AND status='awaiting-answer' AND hidden_material=1)", [owner.userId]),
  ];
}
function eventStatement(db: D1Database, owner: SiteIdentity, requestId: string, state: ScopeState, input: unknown): D1PreparedStatement {
  return db.prepare("INSERT INTO scope_events VALUES (?,?,?,?,?,?)").bind(owner.userId, requestId, state.input.id, state.version, JSON.stringify({ input, state }), Date.now());
}
async function saveScopeTransition(db: D1Database, bucket: R2Bucket, cmd: Command, state: ScopeState, action: string, input: unknown): Promise<Receipt> {
  await requireCurrentScope(db, bucket, cmd.owner, state);
  return executeAtomic(db, cmd, `librarian.${action}`, input, state.input.id, state.version, (requestId) => [
    ...guards(db, cmd.owner, state, requestId),
    ...guardedUpdate(db, "study_scopes", cmd.owner.userId, state.input.id, cmd.expectedVersion, requestId, 0, "state=?", [JSON.stringify(state)], "json_extract(state,'$.phase')!='confirmed'", []),
    eventStatement(db, cmd.owner, requestId, state, input),
  ]);
}
export async function createStudyScope(db: D1Database, bucket: R2Bucket, cmd: Command, input: ScopeInput): Promise<Receipt> {
  if (cmd.expectedVersion !== 1) throw domainFailure("version_conflict", "librarian.scope-start-version", null);
  const unit = await readConfirmedUnit(db, cmd.owner, input.planVersionId, input.unitId);
  const links = await Promise.all(input.linkIds.map((id) => getMaterialLink(db, cmd.owner, id)));
  const candidates = await Promise.all(links.map((link) => inspectMaterialLink(db, bucket, cmd.owner, link)));
  const state = initialStudyScope(input, unit, candidates, await readPrerequisiteStates(db, cmd.owner, unit.prerequisiteUnitIds), await readUnitProgress(db, cmd.owner, unit.unitId));
  return executeAtomic(db, cmd, "librarian.scope-start", input, input.id, 1, (requestId) => [
    ...guards(db, cmd.owner, state, requestId), db.prepare("INSERT INTO study_scopes VALUES (?,?,1,?,?,?,?)").bind(cmd.owner.userId, input.id, requestId, input.planVersionId, input.unitId, JSON.stringify(state)), eventStatement(db, cmd.owner, requestId, state, input),
  ]);
}
export async function beginStoredScopeEvaluation(db: D1Database, bucket: R2Bucket, cmd: Command, id: string): Promise<Receipt> {
  return saveScopeTransition(db, bucket, cmd, beginScopeEvaluation(await previousScope(db, cmd, id)), "scope-begin", { id });
}
export async function saveScopeEvaluation(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, previous: ScopeState, evaluation: LibrarianEvaluation): Promise<Receipt> {
  if (!previous.pendingKey) throw domainFailure("version_conflict", "librarian.scope-finish-key", null);
  return saveScopeTransition(db, bucket, { owner, requestKey: `${previous.pendingKey}:complete`, expectedVersion: previous.version }, finishScopeEvaluation(previous, evaluation), "scope-finish", evaluation);
}
export const scopeConfirmation = z.object({ reviewedVersion: version, reviewedSources: z.literal(true), acceptedTime: z.literal(true), acceptedAssessment: z.literal(true) }).strict();
export type ScopeConfirmation = Readonly<z.infer<typeof scopeConfirmation>>;
export async function confirmStoredScope(db: D1Database, bucket: R2Bucket, cmd: Command, id: string, value: ScopeConfirmation): Promise<Receipt> {
  const input: ScopeConfirmation = scopeConfirmation.parse(value);
  if (input.reviewedVersion !== cmd.expectedVersion) throw domainFailure("version_conflict", "librarian.scope-confirm-version", null);
  return saveScopeTransition(db, bucket, cmd, confirmStudyScope(await previousScope(db, cmd, id)), "scope-confirm", input);
}
/** Tutor에는 확정됐고 현재도 유효한 범위만 전달합니다. */
export async function readTutorBundle(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, id: string): Promise<TutorBundle> {
  const state = await getStudyScope(db, owner, id);
  if (state.phase !== "confirmed" || !state.bundle) throw domainFailure("reference_conflict", "librarian.tutor-unconfirmed", null);
  await requireCurrentScope(db, bucket, owner, state);
  return state.bundle;
}
