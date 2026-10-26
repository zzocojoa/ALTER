import { currentWeeklyExportSql } from "../../lib/google-report/current.ts";
import { z } from "zod";
import { command, recordId, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { externalWorkflowState } from "../../lib/external/state.ts";
import { prepareExternalCreation } from "../../lib/external/creation.ts";
import type { ExternalCreationPlan, ExternalWorkflowSeed } from "../../lib/external/creation.ts";
import { readManagedGoogleConnection } from "./google-managed.ts";
import type { ManagedGoogleConnection } from "./google-managed.ts";
import { executeAtomic, isDomainFailure, readStorage, requireInBatch } from "./atomic.ts";
import { externalJobStatements } from "./external.ts";

export const externalWorkflowRow = z.object({ id: recordId, version: z.number().int().positive(), state: externalWorkflowState, requestHash: z.string().length(64), googleSubject: z.string(), targetKey: z.string(), sourceVersion: z.string() }).strict();
export type ExternalWorkflowRow = Readonly<z.infer<typeof externalWorkflowRow>>;
export type ExternalCreationFailure = Error & Readonly<{ code: "external_request_conflict" | "external_predecessor_required" | "external_connection_required"; operation: string }>;
export function externalCreationFailure(code: ExternalCreationFailure["code"], operation: string): ExternalCreationFailure {
  return Object.assign(new Error(code === "external_request_conflict" ? "같은 외부 작업에 다른 내용이 제출됐어요. 확정본과 요청 키를 확인해 주세요." : code === "external_predecessor_required" ? "이전 외부 작업의 확인 상태와 대상 식별자를 확인해 주세요." : "현재 Google 연결 계정을 확인해 주세요."), { name: "ExternalCreationFailure", code, operation });
}
const columns: string = "w.id,w.version,w.state,w.request_hash AS requestHash,w.google_subject AS googleSubject,w.target_key AS targetKey,w.source_version AS sourceVersion";
async function findExisting(db: D1Database, owner: SiteIdentity, requestKey: string, plan: ExternalCreationPlan): Promise<ExternalWorkflowRow | null> {
  const alias = await readStorage("external.workflow.alias", () => db.prepare(`SELECT ${columns},a.request_hash AS aliasHash FROM external_request_keys a JOIN external_workflows w ON w.owner_id=a.owner_id AND w.id=a.workflow_id WHERE a.owner_id=? AND a.request_key=?`).bind(owner.userId, requestKey).first());
  if (alias) {
    const parsed = externalWorkflowRow.extend({ aliasHash: z.string() }).parse(alias);
    if (parsed.aliasHash !== plan.requestHash || parsed.requestHash !== plan.requestHash) throw externalCreationFailure("external_request_conflict", "request-key-reused");
    return externalWorkflowRow.strip().parse(parsed);
  }
  const existing = await readStorage("external.workflow.business", () => db.prepare(`SELECT ${columns} FROM external_workflows w WHERE owner_id=? AND kind=? AND target_key=? AND source_version=?`).bind(owner.userId, plan.seed.kind, plan.seed.targetKey, plan.seed.sourceVersion).first());
  if (!existing) return null;
  const row: ExternalWorkflowRow = externalWorkflowRow.parse(existing);
  if (row.requestHash !== plan.requestHash) throw externalCreationFailure("external_request_conflict", "business-version-content-changed");
  return row;
}
async function attachAlias(db: D1Database, owner: SiteIdentity, requestKey: string, row: ExternalWorkflowRow, now: number): Promise<void> {
  const cmd = command.parse({ owner, requestKey: `alias:${requestKey}`, expectedVersion: 1 });
  await executeAtomic(db, cmd, "external.workflow.alias", { requestKey, hash: row.requestHash }, row.id, row.version, requestId => [
    db.prepare("INSERT INTO external_request_keys VALUES (?,?,?,?,?) ON CONFLICT(owner_id,request_key) DO NOTHING").bind(owner.userId, requestKey, row.id, row.requestHash, now),
    requireInBatch(db, owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM external_request_keys WHERE owner_id=? AND request_key=? AND workflow_id=? AND request_hash=?)", [owner.userId, requestKey, row.id, row.requestHash]),
  ]);
}
async function requirePredecessor(db: D1Database, owner: SiteIdentity, plan: ExternalCreationPlan): Promise<void> {
  if (plan.seed.predecessorId === null) return;
  const previous = await readStorage("external.workflow.predecessor", () => db.prepare("SELECT id FROM external_workflows WHERE owner_id=? AND id=? AND kind=? AND target_key=? AND state='confirmed'").bind(owner.userId, plan.seed.predecessorId, plan.seed.kind, plan.seed.targetKey).first());
  if (!previous) throw externalCreationFailure("external_predecessor_required", "previous-workflow-unverified");
  const targets = await readStorage("external.workflow.previous-targets", () => db.prepare("SELECT DISTINCT external_id FROM external_operations WHERE owner_id=? AND workflow_id=? AND state='confirmed' AND external_id IS NOT NULL").bind(owner.userId, plan.seed.predecessorId).all<{ external_id: string }>());
  if (targets.results.length === 0 || plan.operations.some(operation => operation.externalId === null || !targets.results.some(target => target.external_id === operation.externalId))) throw externalCreationFailure("external_predecessor_required", "previous-external-target-not-retained");
}
type LegacyStep = Readonly<{ id: string; kind: string }>;
async function creationSteps(db: D1Database, owner: SiteIdentity, plan: ExternalCreationPlan): Promise<readonly LegacyStep[]> {
  const kinds: readonly string[] = [...new Set(plan.operations.map(operation => operation.stepKind))];
  if (plan.seed.jobId === null) return kinds.map(kind => ({ id: crypto.randomUUID(), kind }));
  const existing = await readStorage("external.workflow.legacy-job", () => db.prepare("SELECT kind,state FROM external_jobs WHERE owner_id=? AND id=?").bind(owner.userId, plan.seed.jobId).first<{ kind: string; state: string }>());
  if (!existing || existing.kind !== plan.seed.kind || existing.state !== "pending") throw externalCreationFailure("external_request_conflict", "legacy-job-not-pending");
  const steps = await readStorage("external.workflow.legacy-steps", () => db.prepare("SELECT id,kind FROM external_steps WHERE owner_id=? AND job_id=? AND state='pending' ORDER BY ordinal").bind(owner.userId, plan.seed.jobId).all<LegacyStep>());
  if (steps.results.length !== kinds.length || kinds.some(kind => steps.results.filter(step => step.kind === kind).length !== 1)) throw externalCreationFailure("external_request_conflict", "legacy-step-contract");
  return steps.results;
}

/** 중복 요청은 기존 작업으로 수렴하며 미확인 쓰기를 새 요청 키로 우회하지 못합니다. */
export async function createExternalWorkflow(db: D1Database, owner: SiteIdentity, requestKey: string, value: ExternalWorkflowSeed, now: number): Promise<ExternalWorkflowRow> {
  z.string().min(1).max(180).parse(requestKey); timestamp.parse(now);
  const connection: ManagedGoogleConnection | null = await readManagedGoogleConnection(db, owner);
  if (!connection || !["active", "partial"].includes(connection.state)) throw externalCreationFailure("external_connection_required", "current-google-account");
  const plan: ExternalCreationPlan = await prepareExternalCreation(value, connection.googleSubject);
  const existing: ExternalWorkflowRow | null = await findExisting(db, owner, requestKey, plan);
  if (existing) { await attachAlias(db, owner, requestKey, existing, now); return existing; }
  await requirePredecessor(db, owner, plan);
  const steps: readonly LegacyStep[] = await creationSteps(db, owner, plan);
  const id = plan.seed.jobId ?? recordId.parse(crypto.randomUUID());
  const operations = plan.operations.map((operation, index) => ({ ...operation, id: crypto.randomUUID(), ordinal: index + 1, stepId: steps.find(step => step.kind === operation.stepKind)?.id }));
  if (operations.some(operation => !operation.stepId)) throw externalCreationFailure("external_request_conflict", "missing-step");
  const cmd = command.parse({ owner, requestKey, expectedVersion: 1 });
  try {
    await executeAtomic(db, cmd, "external.workflow.create", { hash: plan.requestHash }, id, 1, requestId => [
      requireInBatch(db, owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM google_runtime r JOIN google_connections c ON c.owner_id=r.owner_id AND c.id=r.connection_id WHERE r.owner_id=? AND r.connection_id=? AND r.generation=? AND r.state IN ('active','partial') AND c.google_subject=?)", [owner.userId, connection.connectionId, connection.generation, connection.googleSubject]),
      ...(plan.seed.jobId === null ? externalJobStatements(db, cmd, { id, weeklyVersionId: null, businessKey: `external:${plan.requestHash}`, kind: plan.seed.kind, steps: steps.map(step => ({ id: recordId.parse(step.id), kind: step.kind })) }, requestId) : []),
      requireInBatch(db, owner.userId, requestId, 1, "EXISTS(SELECT 1 FROM external_jobs WHERE owner_id=? AND id=? AND kind=? AND state='pending') AND NOT EXISTS(SELECT 1 FROM external_steps WHERE owner_id=? AND job_id=? AND state!='pending')", [owner.userId, id, plan.seed.kind, owner.userId, id]),
      requireInBatch(db,owner.userId,requestId,2,`EXISTS(SELECT 1 FROM external_jobs j WHERE j.owner_id=? AND j.id=? AND ${currentWeeklyExportSql})`,[owner.userId,id]),
      db.prepare("INSERT INTO external_workflows VALUES (?,?,1,?,?,?,?,?,?,?,?,?,'pending',?,?)").bind(owner.userId, id, requestId, plan.seed.kind, plan.seed.targetKey, plan.seed.sourceVersion, plan.requestHash, plan.snapshot, connection.connectionId, connection.googleSubject, connection.generation, now, now + 86_400_000),
      db.prepare("INSERT INTO external_request_keys VALUES (?,?,?,?,?)").bind(owner.userId, requestKey, id, plan.requestHash, now),
      ...operations.map(operation => db.prepare("INSERT INTO external_operations VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,'pending',NULL,0,NULL,NULL,NULL,0,0,NULL,NULL)").bind(owner.userId, operation.id, requestId, id, operation.stepId as string, operation.ordinal, operation.kind, operation.businessKey, operation.snapshot, operation.requestHash, operation.expectedHash, operation.externalId)),
    ]);
  } catch (error: unknown) {
    if (!isDomainFailure(error) || !["reference_conflict", "version_conflict", "request_key_reused"].includes(error.code)) throw error;
    const raced: ExternalWorkflowRow | null = await findExisting(db, owner, requestKey, plan);
    if (!raced) throw error;
    await attachAlias(db, owner, requestKey, raced, now); return raced;
  }
  return externalWorkflowRow.parse({ id, version: 1, state: "pending", requestHash: plan.requestHash, googleSubject: connection.googleSubject, targetKey: plan.seed.targetKey, sourceVersion: plan.seed.sourceVersion });
}
