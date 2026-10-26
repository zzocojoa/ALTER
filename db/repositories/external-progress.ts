import { z } from "zod";
import { externalFailure } from "../../lib/external/failure.ts";
import type { ExternalFailure } from "../../lib/external/failure.ts";
import { command, domainFailure, recordId, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { externalVerification } from "../../lib/external/verification.ts";
import type { ExternalVerification } from "../../lib/external/verification.ts";
import { executeAtomic, guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { SqlValue } from "./atomic.ts";
import { readExternalOperation, requireExternalLease } from "./external-operation.ts";
import type { ExternalLease, ExternalOperationRow } from "./external-operation.ts";

type Versions = Readonly<{ workflowVersion:number;jobVersion:number;stepVersion:number }>;
export type ExternalStoredFailure = ExternalFailure;
async function readVersions(db:D1Database,owner:SiteIdentity,row:ExternalOperationRow):Promise<Versions> {
  const value=await readStorage("external.progress.versions",()=>db.prepare("SELECT w.version AS workflowVersion,j.version AS jobVersion,s.version AS stepVersion FROM external_workflows w JOIN external_jobs j ON j.owner_id=w.owner_id AND j.id=w.id JOIN external_steps s ON s.owner_id=w.owner_id AND s.job_id=w.id WHERE w.owner_id=? AND w.id=? AND s.id=?").bind(owner.userId,row.workflowId,row.stepId).first<Versions>());
  if(!value) throw domainFailure("reference_conflict","external.progress.parent",null); return value;
}
function projectionStatements(db:D1Database,owner:SiteIdentity,row:ExternalOperationRow,versions:Versions,requestId:string,now:number):readonly D1PreparedStatement[] {
  const aggregate:string="CASE WHEN NOT EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_workflows.owner_id AND o.workflow_id=external_workflows.id AND o.state!='confirmed') THEN 'confirmed' WHEN EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_workflows.owner_id AND o.workflow_id=external_workflows.id AND o.state='conflict') THEN 'conflict' WHEN EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_workflows.owner_id AND o.workflow_id=external_workflows.id AND o.state='unknown') THEN 'unknown' WHEN EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_workflows.owner_id AND o.workflow_id=external_workflows.id AND o.state='failed') THEN 'failed' WHEN EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_workflows.owner_id AND o.workflow_id=external_workflows.id AND o.state IN ('running','received')) THEN 'running' WHEN EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_workflows.owner_id AND o.workflow_id=external_workflows.id AND o.state='confirmed') THEN 'partial' ELSE 'pending' END";
  return [
    ...guardedUpdate(db,"external_workflows",owner.userId,row.workflowId,versions.workflowVersion,requestId,3,`state=${aggregate}`,[],"state!='confirmed'",[]),
    ...guardedUpdate(db,"external_jobs",owner.userId,row.workflowId,versions.jobVersion,requestId,4,"state=(SELECT CASE state WHEN 'confirmed' THEN 'complete' WHEN 'failed' THEN 'conflict' WHEN 'conflict' THEN 'conflict' WHEN 'partial' THEN 'partial' WHEN 'pending' THEN 'pending' ELSE 'running' END FROM external_workflows WHERE owner_id=? AND id=?)",[owner.userId,row.workflowId],"kind!='ai'",[]),
    ...guardedUpdate(db,"external_steps",owner.userId,row.stepId,versions.stepVersion,requestId,5,"state=CASE WHEN NOT EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_steps.owner_id AND o.step_id=external_steps.id AND o.state!='confirmed') THEN 'confirmed' WHEN EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_steps.owner_id AND o.step_id=external_steps.id AND o.state IN ('conflict','failed')) THEN 'conflict' WHEN EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_steps.owner_id AND o.step_id=external_steps.id AND o.state='unknown') THEN 'unknown' WHEN NOT EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=external_steps.owner_id AND o.step_id=external_steps.id AND o.state!='pending') THEN 'pending' ELSE 'leased' END,external_id=coalesce(external_id,(SELECT external_id FROM external_operations WHERE owner_id=? AND id=?)),evidence=json_object('workflowId',?,'checkedAt',?,'verifiedOperations',(SELECT count(*) FROM external_operations WHERE owner_id=? AND step_id=? AND state='confirmed'))",[owner.userId,row.id,row.workflowId,now,owner.userId,row.stepId],"state!='confirmed'",[]),
  ];
}
export async function recordExternalIntent(db:D1Database,owner:SiteIdentity,lease:ExternalLease,now:number):Promise<ExternalOperationRow> {
  const row:ExternalOperationRow=await requireExternalLease(db,owner,lease,now);
  if(row.intentAt!==null){
    const proof=externalVerification.safeParse(row.verification===null?null:JSON.parse(row.verification));
    if(!proof.success || proof.data.status!=="not-executed" || proof.data.basis!=="google-write-request-absent-and-fenced" || proof.data.fencedEpoch>=row.leaseEpoch)throw domainFailure("result_unknown","external.intent-retry-not-proven",null);
    return row;
  }
  const cmd=command.parse({owner,requestKey:`${lease.leaseId}:intent`,expectedVersion:lease.expectedVersion});
  await executeAtomic(db,cmd,"external.operation.intent",{lease,now},row.id,row.version+1,requestId=>[
    ...guardedUpdate(db,"external_operations",owner.userId,row.id,row.version,requestId,0,"intent_at=?",[now],"state='running' AND lease_id=? AND lease_epoch=? AND lease_until>? AND intent_at IS NULL",[lease.leaseId,lease.epoch,now]),
    requireInBatch(db,owner.userId,requestId,1,"EXISTS(SELECT 1 FROM external_attempt_records WHERE owner_id=? AND operation_id=? AND lease_id=? AND lease_epoch=? AND mode='write' AND state='started')",[owner.userId,row.id,lease.leaseId,lease.epoch]),
  ]);
  const changed=await readExternalOperation(db,owner,row.id);
  if(changed.version!==row.version+1) throw domainFailure("version_conflict","external.intent-replaced",null);return changed;
}
type Completion = Readonly<{operationState:"pending"|"received"|"confirmed"|"unknown"|"failed"|"conflict";attemptState:"not-sent"|"received"|"verified"|"unknown"|"failed"|"conflict";externalId:string|null;providerRequestId:string|null;status:number|null;verification:ExternalVerification|null;failure:ExternalStoredFailure|null;nextAttemptAt:number;responseAt:number|null}>;
async function completeOperation(db:D1Database,owner:SiteIdentity,lease:ExternalLease,completion:Completion,now:number):Promise<ExternalOperationRow> {
  const row:ExternalOperationRow=await requireExternalLease(db,owner,lease,now);const versions:Versions=await readVersions(db,owner,row);timestamp.parse(completion.nextAttemptAt);
  const cmd=command.parse({owner,requestKey:`${lease.leaseId}:finish`,expectedVersion:lease.expectedVersion});
  const evidence:string|null=completion.verification===null?null:JSON.stringify(externalVerification.parse(completion.verification));
  const error:string|null=completion.failure===null?null:JSON.stringify(externalFailure.parse(completion.failure));
  const assignments:readonly SqlValue[]=[completion.operationState,completion.externalId,evidence,error,completion.nextAttemptAt,completion.responseAt];
  await executeAtomic(db,cmd,"external.operation.finish",{lease,completion,now},row.id,row.version+1,requestId=>[
    ...guardedUpdate(db,"external_operations",owner.userId,row.id,row.version,requestId,0,"state=?,external_id=coalesce(external_id,?),verification=?,last_error=?,next_attempt_at=?,response_at=coalesce(response_at,?),lease_id=NULL,lease_until=NULL",assignments,"state='running' AND lease_id=? AND lease_epoch=? AND lease_until>?",[lease.leaseId,lease.epoch,now]),
    db.prepare("UPDATE external_attempt_records SET state=?,finished_at=?,provider_request_id=?,status_code=?,error=?,verification=? WHERE owner_id=? AND operation_id=? AND lease_id=? AND lease_epoch=? AND state='started'").bind(completion.attemptState,now,completion.providerRequestId,completion.status,error,evidence,owner.userId,row.id,lease.leaseId,lease.epoch),
    requireInBatch(db,owner.userId,requestId,1,"(SELECT count(*) FROM external_attempt_records WHERE owner_id=? AND operation_id=? AND lease_id=? AND lease_epoch=? AND state=? AND finished_at=?)=1",[owner.userId,row.id,lease.leaseId,lease.epoch,completion.attemptState,now]),
    ...(completion.providerRequestId===null?[]:[requireInBatch(db,owner.userId,requestId,2,"EXISTS(SELECT 1 FROM google_requests q JOIN external_workflows w ON w.owner_id=q.owner_id AND w.google_subject=q.google_subject JOIN external_attempt_records a ON a.owner_id=q.owner_id AND a.id=q.id WHERE q.owner_id=? AND q.id=? AND w.id=? AND q.state='succeeded' AND q.status BETWEEN 200 AND 299 AND q.status=? AND a.operation_id=? AND a.lease_id=? AND a.lease_epoch=? AND a.mode=? AND q.sent_at>=a.started_at AND ((a.mode='verify' AND (q.method LIKE '%.get' OR q.method LIKE '%.list')) OR (a.mode='write' AND q.method NOT LIKE '%.get' AND q.method NOT LIKE '%.list' AND q.method!='picker.open')))",[owner.userId,completion.providerRequestId,row.workflowId,completion.status,row.id,lease.leaseId,lease.epoch,completion.attemptState==="received"?"write":"verify"])]),
    ...(completion.operationState!=="pending"?[]:[requireInBatch(db,owner.userId,requestId,6,"EXISTS(SELECT 1 FROM external_operations o WHERE o.owner_id=? AND o.id=? AND (o.intent_at IS NULL OR json_extract(o.verification,'$.basis')='google-write-request-absent-and-fenced') AND json_extract(o.verification,'$.status')='not-executed' AND json_extract(o.verification,'$.fencedEpoch')=o.lease_epoch AND json_extract(o.verification,'$.priorEpoch')<o.lease_epoch) AND EXISTS(SELECT 1 FROM external_attempt_records a WHERE a.owner_id=? AND a.operation_id=? AND a.lease_epoch=? AND a.mode='verify' AND a.state='not-sent') AND EXISTS(SELECT 1 FROM external_attempt_records a WHERE a.owner_id=? AND a.operation_id=? AND a.lease_epoch<? AND a.mode='write') AND NOT EXISTS(SELECT 1 FROM external_attempt_records a LEFT JOIN google_requests q ON q.owner_id=a.owner_id AND q.id=a.id WHERE a.owner_id=? AND a.operation_id=? AND a.mode='write' AND (a.finished_at IS NULL OR q.id IS NOT NULL))",[owner.userId,row.id,owner.userId,row.id,lease.epoch,owner.userId,row.id,lease.epoch,owner.userId,row.id])]),
    ...projectionStatements(db,owner,row,versions,requestId,now),
  ]);
  const changed:ExternalOperationRow=await readExternalOperation(db,owner,row.id);if(changed.version!==row.version+1) throw domainFailure("version_conflict","external.completion-replaced",null);return changed;
}
export async function recordExternalWriteResponse(db:D1Database,owner:SiteIdentity,lease:ExternalLease,value:Readonly<{externalId:string;providerRequestId:string;status:number}>,now:number):Promise<ExternalOperationRow> {
  recordId.parse(value.providerRequestId);z.string().min(1).max(1024).parse(value.externalId);z.number().int().min(200).max(299).parse(value.status);
  const row=await requireExternalLease(db,owner,lease,now);
  if(row.intentAt===null || row.externalId!==null && row.externalId!==value.externalId) throw domainFailure("reference_conflict","external.write-response-identity",null);
  return completeOperation(db,owner,lease,{operationState:"received",attemptState:"received",externalId:value.externalId,providerRequestId:value.providerRequestId,status:value.status,verification:null,failure:null,nextAttemptAt:0,responseAt:now},now);
}
export async function recordExternalVerification(db:D1Database,owner:SiteIdentity,lease:ExternalLease,proof:ExternalVerification,provider:Readonly<{id:string;status:number}>|null,nextAttemptAt:number,now:number):Promise<ExternalOperationRow> {
  const verification:ExternalVerification=externalVerification.parse(proof);
  const providerRequestId:string|null=provider?.id ?? null;
  if(provider!==null) z.number().int().min(200).max(299).parse(provider.status);
  if(verification.status==="not-executed") throw domainFailure("validation","external.nonexecution-needs-separate-guard",null);
  const row:ExternalOperationRow=await requireExternalLease(db,owner,lease,now);
  if(verification.checkedAt>now || verification.status==="matched" && (verification.expectedHash!==row.expectedHash || providerRequestId===null || row.externalId!==null && row.externalId!==verification.externalId)) throw domainFailure("reference_conflict","external.verification-binding",null);
  if(providerRequestId!==null) recordId.parse(providerRequestId);
  const state=verification.status==="matched"?"confirmed":verification.status;
  return completeOperation(db,owner,lease,{operationState:state,attemptState:verification.status==="matched"?"verified":verification.status,externalId:verification.status==="matched"?verification.externalId:null,providerRequestId,status:provider===null?null:provider.status,verification,failure:null,nextAttemptAt,responseAt:null},now);
}
export async function recordExternalFailure(db:D1Database,owner:SiteIdentity,lease:ExternalLease,error:ExternalStoredFailure,nextAttemptAt:number,now:number):Promise<ExternalOperationRow> {
  const failure:ExternalStoredFailure=externalFailure.parse(error);const row=await requireExternalLease(db,owner,lease,now);
  const state:"unknown"|"failed"|"conflict"=failure.category==="conflict"?"conflict":row.intentAt===null?"failed":"unknown";
  return completeOperation(db,owner,lease,{operationState:state,attemptState:state,externalId:null,providerRequestId:null,status:failure.status,verification:null,failure,nextAttemptAt,responseAt:null},now);
}

/** 전송 의도가 한 번도 기록되지 않았고 이전 실행이 CAS로 차단된 경우만 쓰기 대기로 되돌립니다. */
export async function proveExternalNonexecution(db:D1Database,owner:SiteIdentity,lease:ExternalLease,now:number):Promise<ExternalOperationRow> {
  const row:ExternalOperationRow=await requireExternalLease(db,owner,lease,now);
  const prior=await readStorage("external.nonexecution.prior",()=>db.prepare("SELECT max(lease_epoch) AS epoch FROM external_attempt_records WHERE owner_id=? AND operation_id=? AND mode='write' AND lease_epoch<?").bind(owner.userId,row.id,lease.epoch).first<{epoch:number|null}>());
  if(row.intentAt!==null || prior?.epoch===null || prior===null) throw domainFailure("result_unknown","external.nonexecution-not-proven",null);
  const proof:ExternalVerification=externalVerification.parse({status:"not-executed",basis:"durable-intent-absent-and-fenced",priorEpoch:prior.epoch,fencedEpoch:lease.epoch,checkedAt:now});
  return completeOperation(db,owner,lease,{operationState:"pending",attemptState:"not-sent",externalId:null,providerRequestId:null,status:null,verification:proof,failure:null,nextAttemptAt:0,responseAt:null},now);
}

/** 보조 읽기만 기록된 종료 시도를 새 선점으로 차단하고, 실제 쓰기 요청이 없음을 원장에서 증명합니다. */
export async function proveGooglePreflightNonexecution(db:D1Database,owner:SiteIdentity,lease:ExternalLease,now:number):Promise<ExternalOperationRow|null> {
  const row=await requireExternalLease(db,owner,lease,now);
  if(row.intentAt===null)return null;
  const proof=await readStorage("external.google-preflight-proof",()=>db.prepare("SELECT max(a.lease_epoch) AS epoch FROM external_attempt_records a WHERE a.owner_id=? AND a.operation_id=? AND a.mode='write' AND a.lease_epoch<? AND EXISTS(SELECT 1 FROM external_google_requests g JOIN google_requests q ON q.owner_id=g.owner_id AND q.id=g.id WHERE g.owner_id=a.owner_id AND g.attempt_id=a.id AND (q.method LIKE '%.get' OR q.method LIKE '%.list') AND q.sent_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM external_attempt_records prior LEFT JOIN google_requests main ON main.owner_id=prior.owner_id AND main.id=prior.id WHERE prior.owner_id=a.owner_id AND prior.operation_id=a.operation_id AND prior.mode='write' AND (prior.finished_at IS NULL OR prior.lease_epoch>=? OR main.id IS NOT NULL)) AND NOT EXISTS(SELECT 1 FROM external_google_requests g JOIN external_attempt_records prior ON prior.owner_id=g.owner_id AND prior.id=g.attempt_id JOIN google_requests q ON q.owner_id=g.owner_id AND q.id=g.id WHERE prior.owner_id=a.owner_id AND prior.operation_id=a.operation_id AND q.method NOT LIKE '%.get' AND q.method NOT LIKE '%.list')").bind(owner.userId,row.id,lease.epoch,lease.epoch).first<{epoch:number|null}>());
  if(proof?.epoch===null || proof===null)return null;
  const verification:ExternalVerification={status:"not-executed",basis:"google-write-request-absent-and-fenced",priorEpoch:proof.epoch,fencedEpoch:lease.epoch,checkedAt:now};
  return completeOperation(db,owner,lease,{operationState:"pending",attemptState:"not-sent",externalId:null,providerRequestId:null,status:null,verification,failure:null,nextAttemptAt:0,responseAt:null},now);
}
