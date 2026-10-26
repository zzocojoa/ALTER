import { requireCurrentExecutionAuthority } from "./restore-execution.ts";
import { externalVerification } from "../../lib/external/verification.ts";
import { externalSheetClaimStatements } from "./external-sheet-lock.ts";
import { z } from "zod";
import { externalMaximumAttempts } from "../../lib/external/retry.ts";
import { command, domainFailure, recordId, timestamp, version } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { externalOperationState, transitionExternalOperation } from "../../lib/external/state.ts";
import { executeAtomic, guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

export const externalOperationRow = z.object({ id: recordId, workflowId: recordId, stepId: recordId, version, ordinal: version, kind: z.string(), businessKey: z.string(), snapshot: z.string(), requestHash: z.string().length(64), expectedHash: z.string().length(64), externalId: z.string().nullable(), state: externalOperationState, leaseId: recordId.nullable(), leaseEpoch: z.number().int().nonnegative(), leaseUntil: timestamp.nullable(), intentAt: timestamp.nullable(), responseAt: timestamp.nullable(), attemptCount: z.number().int().nonnegative(), nextAttemptAt: timestamp, verification: z.string().nullable(), lastError: z.string().nullable() }).strict();
export type ExternalOperationRow = Readonly<z.infer<typeof externalOperationRow>>;
export const externalLease = z.object({ operationId: recordId, expectedVersion: version, leaseId: recordId, epoch: version }).strict();
export type ExternalLease = Readonly<z.infer<typeof externalLease>>;
const claimInput = z.object({ operationId: recordId, expectedVersion: version, leaseId: recordId, attemptId: recordId, now: timestamp, leaseUntil: timestamp }).strict().refine(value => value.leaseUntil > value.now && value.leaseUntil <= value.now + 60_000);
export type ExternalClaimInput = Readonly<z.infer<typeof claimInput>>;
type WorkflowVersion = Readonly<{ id: string; version: number; deadline_at: number }>;
const operationColumns: string = "id,workflow_id AS workflowId,step_id AS stepId,version,ordinal,kind,business_key AS businessKey,snapshot,request_hash AS requestHash,expected_hash AS expectedHash,external_id AS externalId,state,lease_id AS leaseId,lease_epoch AS leaseEpoch,lease_until AS leaseUntil,intent_at AS intentAt,response_at AS responseAt,attempt_count AS attemptCount,next_attempt_at AS nextAttemptAt,verification,last_error AS lastError";
export async function readExternalOperation(db: D1Database, owner: SiteIdentity, id: string): Promise<ExternalOperationRow> {
  recordId.parse(id);
  const row = await readStorage("external.operation.read", () => db.prepare(`SELECT ${operationColumns} FROM external_operations WHERE owner_id=? AND id=?`).bind(owner.userId, id).first());
  if (!row) throw domainFailure("reference_conflict", "external.operation.owner", null);
  return externalOperationRow.parse(row);
}
async function readWorkflowVersion(db: D1Database, owner: SiteIdentity, id: string): Promise<WorkflowVersion> {
  const row = await readStorage("external.workflow.version", () => db.prepare("SELECT id,version,deadline_at FROM external_workflows WHERE owner_id=? AND id=?").bind(owner.userId, id).first<WorkflowVersion>());
  if (!row) throw domainFailure("reference_conflict", "external.workflow.owner", null);
  return row;
}
async function readChanged(db: D1Database, owner: SiteIdentity, receipt: Receipt): Promise<ExternalOperationRow> {
  const row: ExternalOperationRow = await readExternalOperation(db, owner, receipt.entityId);
  if (row.version !== receipt.version) throw domainFailure("version_conflict", "external.operation.changed-after-save", null);
  return row;
}
/** DB의 실행 버전 검사는 이후의 네트워크 지연을 취소하지 못하므로 전송 의도를 별도로 보존합니다. */
export async function requireExternalLease(db: D1Database, owner: SiteIdentity, value: ExternalLease, now: number): Promise<ExternalOperationRow> {
  await requireCurrentExecutionAuthority(db, owner);
  const lease: ExternalLease = externalLease.parse(value); timestamp.parse(now);
  const row: ExternalOperationRow = await readExternalOperation(db, owner, lease.operationId);
  if (row.version !== lease.expectedVersion || row.state !== "running" || row.leaseId !== lease.leaseId || row.leaseEpoch !== lease.epoch || row.leaseUntil === null || row.leaseUntil <= now) throw domainFailure("version_conflict", "external.operation.lease-lost", null);
  return row;
}
export function operationLease(row: ExternalOperationRow): ExternalLease {
  return externalLease.parse({ operationId: row.id, expectedVersion: row.version, leaseId: row.leaseId, epoch: row.leaseEpoch });
}
type ClaimPlan = Readonly<{ input: ExternalClaimInput; row: ExternalOperationRow; mode: "write" | "verify" }>;
async function commitClaim(db: D1Database, owner: SiteIdentity, plan: ClaimPlan): Promise<ExternalOperationRow> {
  await requireCurrentExecutionAuthority(db, owner);
  const { input, row, mode } = plan;
  const workflow: WorkflowVersion = await readWorkflowVersion(db, owner, row.workflowId);
  if (row.version !== input.expectedVersion || row.nextAttemptAt > input.now || row.attemptCount >= externalMaximumAttempts || workflow.deadline_at <= input.now) throw domainFailure("version_conflict", "external.operation.claim-state", null);
  const cmd = command.parse({ owner, requestKey: input.leaseId, expectedVersion: input.expectedVersion });
  const result = await executeAtomic(db, cmd, "external.operation.claim", { ...input, mode }, row.id, row.version + 1, requestId => [
    ...guardedUpdate(db, "external_operations", owner.userId, row.id, row.version, requestId, 0, "state='running',lease_id=?,lease_epoch=lease_epoch+1,lease_until=?,attempt_count=attempt_count+1", [input.leaseId, input.leaseUntil], "state=? AND next_attempt_at<=? AND attempt_count<? AND NOT EXISTS(SELECT 1 FROM external_operations p WHERE p.owner_id=external_operations.owner_id AND p.workflow_id=external_operations.workflow_id AND p.ordinal<external_operations.ordinal AND p.state!='confirmed')", [row.state, input.now, externalMaximumAttempts]),
    ...externalSheetClaimStatements(db,owner,row,requestId),
    db.prepare("INSERT INTO external_attempt_records VALUES (?,?,?,?,?,?,?,'started',?,NULL,NULL,NULL,NULL,NULL)").bind(owner.userId, input.attemptId, row.id, row.attemptCount + 1, input.leaseId, row.leaseEpoch + 1, mode, input.now),
    ...guardedUpdate(db, "external_workflows", owner.userId, row.workflowId, workflow.version, requestId, 1, "state='running'", [], "state!='confirmed' AND deadline_at>?", [input.now]),
  ]);
  return readChanged(db, owner, result);
}
export async function claimExternalWrite(db: D1Database, owner: SiteIdentity, value: ExternalClaimInput): Promise<ExternalOperationRow> {
  const input: ExternalClaimInput = claimInput.parse(value); const row: ExternalOperationRow = await readExternalOperation(db, owner, input.operationId);
  transitionExternalOperation(row.state, "claim-write");
  if(row.intentAt!==null){
    const proof=externalVerification.safeParse(row.verification===null?null:JSON.parse(row.verification));
    if(!proof.success || proof.data.status!=="not-executed" || proof.data.basis!=="google-write-request-absent-and-fenced" || proof.data.fencedEpoch!==row.leaseEpoch)throw domainFailure("result_unknown","external.operation.write-intent-exists",null);
  }
  return commitClaim(db, owner, { input, row, mode: "write" });
}
export async function claimExternalVerification(db: D1Database, owner: SiteIdentity, value: ExternalClaimInput): Promise<ExternalOperationRow> {
  const input: ExternalClaimInput = claimInput.parse(value); const row: ExternalOperationRow = await readExternalOperation(db, owner, input.operationId);
  transitionExternalOperation(row.state, "claim-verification");
  return commitClaim(db, owner, { input, row, mode: "verify" });
}
/** 성공 응답이 있는 충돌만 명시적으로 재조회하며 쓰기 선점은 허용하지 않습니다. */
export async function claimExternalConflictVerification(db:D1Database,owner:SiteIdentity,value:ExternalClaimInput):Promise<ExternalOperationRow> {
  const input:ExternalClaimInput=claimInput.parse(value);const row=await readExternalOperation(db,owner,input.operationId);
  transitionExternalOperation(row.state,"claim-conflict-verification");
  if(row.intentAt===null || row.responseAt===null || row.externalId===null)throw domainFailure("result_unknown","external.conflict-write-response-required",null);
  return commitClaim(db,owner,{input,row,mode:"verify"});
}
export async function renewExternalLease(db: D1Database, owner: SiteIdentity, lease: ExternalLease, until: number, now: number): Promise<ExternalOperationRow> {
  timestamp.parse(until); const row: ExternalOperationRow = await requireExternalLease(db, owner, lease, now);
  if (row.leaseUntil === null || until <= row.leaseUntil || until > now + 60_000) throw domainFailure("validation", "external.operation.renew-window", null);
  const cmd = command.parse({ owner, requestKey: `${lease.leaseId}:renew:${lease.expectedVersion}`, expectedVersion: lease.expectedVersion });
  const receipt = await executeAtomic(db, cmd, "external.operation.renew", { until, now, lease }, row.id, row.version + 1, requestId => [
    ...guardedUpdate(db, "external_operations", owner.userId, row.id, row.version, requestId, 0, "lease_until=?", [until], "state='running' AND lease_id=? AND lease_epoch=? AND lease_until>?", [lease.leaseId, lease.epoch, now]),
  ]);
  return readChanged(db, owner, receipt);
}

/** 임대 만료는 결과 불명으로 기록하며 다음 실행에는 조회 권한만 허용합니다. */
export async function expireExternalOperationLease(db: D1Database, owner: SiteIdentity, id: string, expectedVersion: number, now: number): Promise<ExternalOperationRow> {
  version.parse(expectedVersion); timestamp.parse(now); const row: ExternalOperationRow = await readExternalOperation(db, owner, id);
  if (row.version !== expectedVersion || row.state !== "running" || row.leaseUntil === null || row.leaseUntil > now) throw domainFailure("version_conflict", "external.operation.lease-not-expired", null);
  const workflow: WorkflowVersion = await readWorkflowVersion(db, owner, row.workflowId);
  const cmd = command.parse({ owner, requestKey: `${row.leaseId}:expired`, expectedVersion });
  const receipt = await executeAtomic(db, cmd, "external.operation.expire", { now, lease: row.leaseId, epoch: row.leaseEpoch }, id, row.version + 1, requestId => [
    ...guardedUpdate(db, "external_operations", owner.userId, id, row.version, requestId, 0, "state='unknown',lease_id=NULL,lease_until=NULL", [], "state='running' AND lease_id=? AND lease_epoch=? AND lease_until<=?", [row.leaseId, row.leaseEpoch, now]),
    db.prepare("UPDATE external_attempt_records SET state='unknown',finished_at=?,error=? WHERE owner_id=? AND operation_id=? AND lease_id=? AND lease_epoch=? AND state='started'").bind(now, JSON.stringify({ code: "lease-expired", phase: "unknown" }), owner.userId, id, row.leaseId, row.leaseEpoch),
    requireInBatch(db, owner.userId, requestId, 1, "(SELECT count(*) FROM external_attempt_records WHERE owner_id=? AND operation_id=? AND lease_id=? AND lease_epoch=? AND state='unknown' AND finished_at=?)=1", [owner.userId, id, row.leaseId, row.leaseEpoch, now]),
    ...guardedUpdate(db, "external_workflows", owner.userId, row.workflowId, workflow.version, requestId, 2, "state='unknown'", [], "state!='confirmed'", []),
  ]);
  return readChanged(db, owner, receipt);
}
