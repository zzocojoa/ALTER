import { z } from "zod";
import { domainFailure, recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { restoreReconciliationInput, restoreReconciliationRow, restoreReadProof } from "../../lib/backup/reconciliation.ts";
import type { RestoreReconciliation, RestoreReconciliationInput, RestoreReadProof } from "../../lib/backup/reconciliation.ts";
import { googleQuotaPolicy, requireGoogleQuotaPolicySuccessor } from "../../lib/google/quota.ts";
import type { GoogleQuotaPlan, GoogleQuotaPolicy } from "../../lib/google/quota.ts";
import type { GoogleRestRequest } from "../../lib/google/rest-request.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import { backupGuard } from "./backup.ts";
import { readRestoredExecution } from "./restore-execution.ts";
import { readManagedGoogleConnection } from "./google-managed.ts";
import type { ManagedGoogleConnection } from "./google-managed.ts";
import { readExternalOperation } from "./external-operation.ts";
import type { ExternalOperationRow } from "./external-operation.ts";

export async function readRestoreReconciliation(db: D1Database, owner: SiteIdentity, id: string): Promise<RestoreReconciliation | null> {
  recordId.parse(id); siteIdentity.parse(owner);
  const row = await db.prepare("SELECT * FROM restore_reconciliations WHERE id=? AND owner_id=?").bind(id, owner.userId).first();
  return row === null ? null : restoreReconciliationRow.parse(row);
}
export async function restoredReadConnection(db: D1Database, owner: SiteIdentity, operation: ExternalOperationRow, now: number): Promise<Readonly<{ runId: string; activatedAt: number; connection: ManagedGoogleConnection }>> {
  const state = await readRestoredExecution(db, owner); const connection = await readManagedGoogleConnection(db, owner);
  if (state?.learning !== "active" || state.runId === null || state.activatedAt === null) throw domainFailure("reference_conflict", "restore.read.activation-required", null);
  const workflow = await db.prepare("SELECT google_subject FROM external_workflows WHERE owner_id=? AND id=?").bind(owner.userId, operation.workflowId).first<{ google_subject: string }>();
  if (connection === null || !["active", "partial"].includes(connection.state) || connection.authorizedAt < state.activatedAt || connection.accessExpiresAt <= now + 30_000 || connection.refreshExpiresAt !== null && connection.refreshExpiresAt <= now || connection.googleSubject !== workflow?.google_subject) throw googleFailure("google_connection_unavailable", "restore.read.fresh-consent-required");
  return { runId: state.runId, activatedAt: state.activatedAt, connection };
}
/** 같은 요청의 재전송은 저장 기록만 반환하고 결과 불명 GET을 자동 재전송하지 않습니다. */
export async function startRestoreReconciliation(db: D1Database, owner: SiteIdentity, value: RestoreReconciliationInput, now: number): Promise<Readonly<{ created: boolean; row: RestoreReconciliation }>> {
  const input = restoreReconciliationInput.parse(value); timestamp.parse(now);
  const previous = await readRestoreReconciliation(db, owner, input.id);
  if (previous !== null) {
    if (previous.operation_id !== input.operationId || previous.operation_version !== input.expectedVersion) throw domainFailure("request_key_reused", "restore.read.replay", null);
    return { created: false, row: previous };
  }
  const operation = await readExternalOperation(db, owner, input.operationId);
  if (operation.version !== input.expectedVersion) throw domainFailure("version_conflict", "restore.read.operation", null);
  const access = await restoredReadConnection(db, owner, operation, now);
  const result = await db.prepare("INSERT INTO restore_reconciliations VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL) ON CONFLICT(id) DO NOTHING RETURNING id").bind(input.id, access.runId, owner.userId, operation.id, operation.version, access.connection.connectionId, access.connection.generation, now, now + 60_000).all<{ id: string }>();
  const row = await readRestoreReconciliation(db, owner, input.id);
  if (!result.success || row === null || row.operation_id !== input.operationId || row.operation_version !== input.expectedVersion) throw domainFailure("result_unknown", "restore.read.start", null);
  return { created: result.results.length === 1 && result.results[0].id === input.id, row };
}
export async function requireRestoreRead(db: D1Database, owner: SiteIdentity, id: string, now: number): Promise<Readonly<{ row: RestoreReconciliation; operation: ExternalOperationRow; connection: ManagedGoogleConnection; activatedAt: number }>> {
  const row = await readRestoreReconciliation(db, owner, id);
  if (row === null || row.finished_at !== null || row.started_at > now || row.expires_at <= now) throw domainFailure("reference_conflict", "restore.read.expired", null);
  const operation = await readExternalOperation(db, owner, row.operation_id); const access = await restoredReadConnection(db, owner, operation, now);
  if (access.runId !== row.run_id || operation.version !== row.operation_version || access.connection.connectionId !== row.connection_id || access.connection.generation !== row.generation) throw domainFailure("reference_conflict", "restore.read.binding-changed", null);
  return { row, operation, connection: access.connection, activatedAt: access.activatedAt };
}
/** 성공 비교도 과거 작업의 상태·임대·전송 이력을 수정하지 않습니다. */
export async function finishRestoreReconciliation(db: D1Database, owner: SiteIdentity, id: string, value: RestoreReadProof, now: number): Promise<RestoreReconciliation> {
  const proof = restoreReadProof.parse(value); timestamp.parse(now);
  const result = await db.prepare("UPDATE restore_reconciliations SET proof=?,finished_at=? WHERE id=? AND owner_id=? AND finished_at IS NULL RETURNING id").bind(JSON.stringify(proof), now, id, owner.userId).all<{ id: string }>();
  if (!result.success || result.results.length !== 1 || result.results[0].id !== id) throw domainFailure("result_unknown", "restore.read.finish", null);
  const row = await readRestoreReconciliation(db, owner, id); if (row === null) throw domainFailure("result_unknown", "restore.read.finish-missing", null); return row;
}

/** 현재 콘솔 상한·과거 예약·새 읽기 예약을 모두 더하며 버전 변경으로 예약을 지우지 않습니다. */
export async function reserveRestoreGoogleRead(db: D1Database, owner: SiteIdentity, reconciliationId: string, requestId: string, request: GoogleRestRequest, policy: GoogleQuotaPolicy, plan: GoogleQuotaPlan, now: number): Promise<void> {
  recordId.parse(requestId); timestamp.parse(now); const access = await requireRestoreRead(db, owner, reconciliationId, now);
  if (request.httpMethod !== "GET" || request.body !== null || request.response !== "json" || plan.ownerId !== owner.userId || plan.method !== request.method || plan.checkedAt < access.activatedAt || plan.validUntil <= now || policy.apis.some(api => api.dimensions.some(dimension => dimension.consoleObservedAt < access.activatedAt))) throw googleFailure("google_quota_unverified", "restore.read.current-evidence");
  const prior = await db.prepare("SELECT policy AS snapshot,policy_version AS version,policy_hash AS hash FROM restore_google_reads WHERE project_id=? ORDER BY policy_version DESC,reserved_at DESC LIMIT 1").bind(plan.projectId).first<{ snapshot: string; version: number; hash: string }>();
  const historical = await db.prepare("SELECT snapshot,version,hash FROM google_quota_policies WHERE owner_id=? AND project_id=?").bind(owner.userId, plan.projectId).first<{ snapshot: string; version: number; hash: string }>();
  const baseline = prior ?? historical;
  if (baseline !== null && baseline.hash !== plan.policyHash) requireGoogleQuotaPolicySuccessor({ ...googleQuotaPolicy.parse(JSON.parse(baseline.snapshot)), ownerId: owner.userId }, policy);
  const guard: string = crypto.randomUUID(); const expiresAt: number = Math.min(access.row.expires_at, plan.validUntil, now + 30_000);
  const statements: D1PreparedStatement[] = [
    backupGuard(db, guard, "EXISTS(SELECT 1 FROM restore_reconciliations r JOIN google_runtime g ON g.owner_id=r.owner_id AND g.connection_id=r.connection_id AND g.generation=r.generation WHERE r.id=? AND r.owner_id=? AND r.finished_at IS NULL AND r.expires_at>? AND g.state IN ('active','partial')) AND (SELECT count(*) FROM restore_google_reads WHERE reconciliation_id=?)<64 AND NOT EXISTS(SELECT 1 FROM restore_google_reads WHERE project_id=? AND (policy_version>? OR (policy_version=? AND policy_hash!=?)))", [reconciliationId, owner.userId, now, reconciliationId, plan.projectId, plan.policyVersion, plan.policyVersion, plan.policyHash]),
    db.prepare("INSERT INTO restore_google_reads VALUES (?,?,?,?,?,?,?,?,?,?,?,'reserved',NULL,NULL,NULL,NULL)").bind(requestId, reconciliationId, request.hash, request.method, plan.projectId, plan.policyVersion, plan.policyHash, JSON.stringify(policy), JSON.stringify(plan.charges), now, expiresAt),
    backupGuard(db, `${guard}-policy`, prior === null ? "NOT EXISTS(SELECT 1 FROM restore_google_reads WHERE project_id=? AND id!=?)" : "(SELECT policy_hash FROM restore_google_reads WHERE project_id=? AND id!=? ORDER BY policy_version DESC,reserved_at DESC LIMIT 1)=?", prior === null ? [plan.projectId, requestId] : [plan.projectId, requestId, prior.hash]),
    backupGuard(db, `${guard}-insert`, "EXISTS(SELECT 1 FROM restore_google_reads WHERE id=? AND reconciliation_id=? AND request_hash=?)", [requestId, reconciliationId, request.hash]),
  ];
  for (const [index, charge] of plan.charges.entries()) statements.push(backupGuard(db, `${guard}-${index}`, "? + (SELECT COALESCE(SUM(weight),0) FROM google_quota_charges WHERE owner_id=? AND project_id=? AND dimension_key=? AND subject=? AND reserved_at>=?) + (SELECT COALESCE(SUM(json_extract(c.value,'$.weight')),0) FROM restore_google_reads r,json_each(r.charges) c WHERE r.project_id=? AND r.reserved_at>=? AND json_extract(c.value,'$.key')=? AND json_extract(c.value,'$.subject')=?) <= ?", [charge.consoleUsedUpper, owner.userId, plan.projectId, charge.key, charge.subject, charge.periodStart, plan.projectId, charge.periodStart, charge.key, charge.subject, charge.limit]));
  statements.push(db.prepare("DELETE FROM backup_checks WHERE id=? OR id LIKE ?").bind(guard, `${guard}-%`)); await db.batch(statements);
}
/** 조건부 전송권은 한 요청에 한 번만 발급하며 응답 유실 후 같은 ID를 다시 보내지 않습니다. */
export async function beginRestoreGoogleRead(db: D1Database, owner: SiteIdentity, id: string, now: number): Promise<void> {
  const result = await db.prepare("UPDATE restore_google_reads SET state='sending',sent_at=? WHERE id=? AND state='reserved' AND reserved_at<=? AND expires_at>? AND EXISTS(SELECT 1 FROM restore_reconciliations r JOIN google_runtime g ON g.owner_id=r.owner_id AND g.connection_id=r.connection_id AND g.generation=r.generation WHERE r.id=restore_google_reads.reconciliation_id AND r.owner_id=? AND r.finished_at IS NULL AND r.expires_at>? AND g.state IN ('active','partial')) RETURNING id").bind(now, id, now, now, owner.userId, now).all<{ id: string }>();
  if (!result.success || result.results.length !== 1 || result.results[0].id !== id) throw domainFailure("result_unknown", "restore.google.read-not-sendable", null);
}
export async function finishRestoreGoogleRead(db: D1Database, owner: SiteIdentity, id: string, state: "succeeded" | "failed" | "unknown", status: number | null, error: string | null, now: number): Promise<void> {
  z.number().int().min(100).max(599).nullable().parse(status); z.string().max(100).nullable().parse(error);
  const result = await db.prepare("UPDATE restore_google_reads SET state=?,status=?,error=?,finished_at=? WHERE id=? AND state='sending' AND EXISTS(SELECT 1 FROM restore_reconciliations r WHERE r.id=restore_google_reads.reconciliation_id AND r.owner_id=?) RETURNING id").bind(state, status, error, now, id, owner.userId).all<{ id: string }>();
  if (!result.success || result.results.length !== 1 || result.results[0].id !== id) throw domainFailure("result_unknown", "restore.google.read-result", null);
}
