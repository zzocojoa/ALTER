import { requireCurrentExecutionAuthority } from "../../db/repositories/restore-execution.ts";
import { requireExternalSheetLock } from "../../db/repositories/external-sheet-lock.ts";
import { currentWeeklyExportSql } from "../google-report/current.ts";
import { externalDiagnosticEntry,externalExecutionFailure } from "./diagnostic.ts";
import type { ExternalDiagnostic } from "./diagnostic.ts";
import { bindExternalTarget } from "../../db/repositories/external-target.ts";
import { z } from "zod";
import { domainFailure, recordId } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { readStorage } from "../../db/repositories/atomic.ts";
import { claimExternalConflictVerification, claimExternalVerification, claimExternalWrite, expireExternalOperationLease, operationLease, readExternalOperation, requireExternalLease } from "../../db/repositories/external-operation.ts";
import type { ExternalClaimInput, ExternalOperationRow } from "../../db/repositories/external-operation.ts";
import { proveGooglePreflightNonexecution, proveExternalNonexecution, recordExternalFailure, recordExternalIntent, recordExternalVerification, recordExternalWriteResponse } from "../../db/repositories/external-progress.ts";
import { classifyExternalFailure,externalFailure } from "./failure.ts";
import { externalMaximumAttempts, externalRetryExhausted, planExternalRetry } from "./retry.ts";
import type { ExternalRetryPlan } from "./retry.ts";
import { externalExpected, verifyExternalContent } from "./verification.ts";
import type { ExternalObservation } from "./verification.ts";

export type ExternalWriteResult=Readonly<{externalId:string;providerRequestId:string;status:number}>;
export type ExternalReadResult=Readonly<{observation:ExternalObservation;receipt:Readonly<{id:string;status:number}>|null}>;
export type ExternalCallContext=Readonly<{operation:ExternalOperationRow;attemptId:string;beforeCall:()=>Promise<void>}>;
export type ExternalTransport=Readonly<{write:(context:ExternalCallContext)=>Promise<ExternalWriteResult>;read:(context:ExternalCallContext)=>Promise<ExternalReadResult>}>;
export type ExternalExecutionRuntime=Readonly<{now:()=>number;id:()=>string;requestBudgetMs:number;jitter:()=>number;warn:(entry:ExternalDiagnostic)=>void}>;
export type ExternalExecutionResult=Readonly<{disposition:"advanced"|"busy"|"deferred"|"retained";operation:ExternalOperationRow}>;
const readOnlyKinds:readonly string[]=["document-verify","sheet-row-verify","report-row-verify","calendar-event-verify","calendar-verify","folder-verify","file-placement-verify","sheet-header-verify"];
async function requireWorkflowGoogleAccount(db:D1Database,owner:SiteIdentity,workflowId:string):Promise<void> {
  const valid=await readStorage("external.execute.google-account",()=>db.prepare(`SELECT w.id FROM external_workflows w JOIN external_jobs j ON j.owner_id=w.owner_id AND j.id=w.id JOIN google_runtime r ON r.owner_id=w.owner_id JOIN google_connections c ON c.owner_id=r.owner_id AND c.id=r.connection_id WHERE w.owner_id=? AND w.id=? AND c.google_subject=w.google_subject AND r.state IN ('active','partial') AND c.revoked_at IS NULL AND c.reconnect_required=0 AND ${currentWeeklyExportSql}`).bind(owner.userId,workflowId).first());
  if(!valid) throw domainFailure("reference_conflict","external.execute.google-account-changed",null);
}
/** 한 요청에서는 쓰기 또는 재조회 한 단계만 진행하며 응답 후 계속 실행되는 큐를 만들지 않습니다. */
export async function runExternalOperation(db:D1Database,owner:SiteIdentity,operationId:string,transport:ExternalTransport,runtime:ExternalExecutionRuntime):Promise<ExternalExecutionResult> {
  await requireCurrentExecutionAuthority(db, owner);
  recordId.parse(operationId);z.number().int().min(5000).max(60_000).parse(runtime.requestBudgetMs);
  let current:ExternalOperationRow=await readExternalOperation(db,owner,operationId);
  if(["confirmed","conflict"].includes(current.state)) return {disposition:"retained",operation:current};
  await requireWorkflowGoogleAccount(db,owner,current.workflowId);
  const now:number=runtime.now();
  const workflow=await readStorage("external.execute.deadline",()=>db.prepare("SELECT deadline_at AS deadlineAt FROM external_workflows WHERE owner_id=? AND id=?").bind(owner.userId,current.workflowId).first<{deadlineAt:number}>());
  if(!workflow) throw domainFailure("reference_conflict","external.execute.workflow",null);
  if(current.state==="running") {
    if(current.leaseUntil===null) throw domainFailure("validation","external.execute.lease-missing",null);
    if(current.leaseUntil>now) return {disposition:"busy",operation:current};
    current=await expireExternalOperationLease(db,owner,current.id,current.version,now);
  }
  if(current.attemptCount>=externalMaximumAttempts || workflow.deadlineAt<=now) {runtime.warn(externalDiagnosticEntry(current,null,current.lastError===null?null:externalFailure.parse(JSON.parse(current.lastError)),"external_retry_exhausted"));throw externalRetryExhausted(current.id,current.attemptCount>=externalMaximumAttempts?"attempt-limit":"deadline",current.lastError);}
  current=await bindExternalTarget(db,owner,current);
  if(current.nextAttemptAt>now) return {disposition:"deferred",operation:current};
  const claim:ExternalClaimInput={operationId:current.id,expectedVersion:current.version,leaseId:recordId.parse(runtime.id()),attemptId:recordId.parse(runtime.id()),now,leaseUntil:now+runtime.requestBudgetMs};
  const phase:"write"|"verify"=current.state==="pending" && !readOnlyKinds.includes(current.kind)?"write":"verify";
  const claimed:ExternalOperationRow=phase==="write"?await claimExternalWrite(db,owner,claim):await claimExternalVerification(db,owner,claim);
  let executing:ExternalOperationRow=claimed;
  try {
    if(phase==="write") executing=await recordExternalIntent(db,owner,operationLease(claimed),runtime.now());
    const context:ExternalCallContext={operation:executing,attemptId:claim.attemptId,beforeCall:async()=>{await requireExternalLease(db,owner,operationLease(executing),runtime.now());await requireWorkflowGoogleAccount(db,owner,executing.workflowId);await requireExternalSheetLock(db,owner,executing);}};
    await context.beforeCall();
    if(phase==="verify" && executing.intentAt===null && !readOnlyKinds.includes(executing.kind)) {
      const prior=await readStorage("external.execute.unsent",()=>db.prepare("SELECT id FROM external_attempt_records WHERE owner_id=? AND operation_id=? AND mode='write' AND lease_epoch<? LIMIT 1").bind(owner.userId,executing.id,executing.leaseEpoch).first());
      if(prior) return {disposition:"advanced",operation:await proveExternalNonexecution(db,owner,operationLease(executing),runtime.now())};
    }
    if(phase==="verify" && executing.intentAt!==null){
      const notSent=await proveGooglePreflightNonexecution(db,owner,operationLease(executing),runtime.now());
      if(notSent!==null)return {disposition:"advanced",operation:notSent};
    }
    if(phase==="write") {
      const result:ExternalWriteResult=await transport.write(context);
      return {disposition:"advanced",operation:await recordExternalWriteResponse(db,owner,operationLease(executing),result,runtime.now())};
    }
    const result:ExternalReadResult=await transport.read(context);
    const snapshot=z.object({request:z.unknown(),expected:externalExpected}).strict().parse(JSON.parse(executing.snapshot));
    const externalId:string|null=executing.externalId;
    const proof=externalId===null?{status:"unknown" as const,reason:"missing-external-id" as const,checkedAt:runtime.now()}:await verifyExternalContent(snapshot.expected,externalId,result.observation,runtime.now());
    const retry:ExternalRetryPlan=planExternalRetry({attemptCount:executing.attemptCount,now:runtime.now(),deadlineAt:workflow.deadlineAt,retryAfterMs:null,jitter:runtime.jitter()});
    const nextAttemptAt:number=proof.status!=="unknown"?0:retry.status==="scheduled"?retry.nextAttemptAt:workflow.deadlineAt;
    return {disposition:"advanced",operation:await recordExternalVerification(db,owner,operationLease(executing),proof,result.receipt,nextAttemptAt,runtime.now())};
  } catch(error:unknown) {
    const failure=classifyExternalFailure(error,phase);
    const retry:ExternalRetryPlan=planExternalRetry({attemptCount:executing.attemptCount,now:runtime.now(),deadlineAt:workflow.deadlineAt,retryAfterMs:failure.retryAfterMs,jitter:runtime.jitter()});
    const nextAttemptAt:number=failure.category!=="temporary"?0:retry.status==="scheduled"?retry.nextAttemptAt:workflow.deadlineAt;
    let saved:ExternalOperationRow;
    try { saved=await recordExternalFailure(db,owner,operationLease(executing),failure,nextAttemptAt,runtime.now()); }
    catch(storageError:unknown) {
      const diagnostic=externalDiagnosticEntry(executing,claim.attemptId,failure,"external_step_failed");runtime.warn(diagnostic);throw externalExecutionFailure(diagnostic,storageError);
    }
    const diagnostic=externalDiagnosticEntry(saved,claim.attemptId,failure,"external_step_failed");runtime.warn(diagnostic);throw externalExecutionFailure(diagnostic,null);
  }
}

/** 명시적인 충돌 확인은 읽기만 수행하고 기존 ID·전송 기록·내용 기대값을 유지합니다. */
export async function recheckExternalConflict(db:D1Database,owner:SiteIdentity,operationId:string,transport:ExternalTransport,runtime:ExternalExecutionRuntime):Promise<ExternalExecutionResult> {
  await requireCurrentExecutionAuthority(db, owner);
  recordId.parse(operationId);z.number().int().min(5000).max(60_000).parse(runtime.requestBudgetMs);
  const current=await readExternalOperation(db,owner,operationId);await requireWorkflowGoogleAccount(db,owner,current.workflowId);
  const now:number=runtime.now();const attemptId:string=runtime.id();
  const claimed=await claimExternalConflictVerification(db,owner,{operationId:recordId.parse(operationId),expectedVersion:current.version,leaseId:recordId.parse(runtime.id()),attemptId:recordId.parse(attemptId),now,leaseUntil:now+runtime.requestBudgetMs});
  const context:ExternalCallContext={operation:claimed,attemptId,beforeCall:async()=>{await requireExternalLease(db,owner,operationLease(claimed),runtime.now());await requireWorkflowGoogleAccount(db,owner,claimed.workflowId);await requireExternalSheetLock(db,owner,claimed);}};
  try {
    await context.beforeCall();const result=await transport.read(context);
    const expected=externalExpected.parse(z.object({expected:z.unknown()}).parse(JSON.parse(claimed.snapshot)).expected);
    if(claimed.externalId===null)throw domainFailure("result_unknown","external.conflict-target-missing",null);
    const proof=await verifyExternalContent(expected,claimed.externalId,result.observation,runtime.now());
    return {disposition:"advanced",operation:await recordExternalVerification(db,owner,operationLease(claimed),proof,result.receipt,0,runtime.now())};
  } catch(error:unknown){
    const failure=classifyExternalFailure(error,"verify");const saved=await recordExternalFailure(db,owner,operationLease(claimed),failure,0,runtime.now());
    const diagnostic=externalDiagnosticEntry(saved,attemptId,failure,"external_step_failed");runtime.warn(diagnostic);throw externalExecutionFailure(diagnostic,null);
  }
}
