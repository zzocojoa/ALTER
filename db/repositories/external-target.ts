import { readManagedGoogleConnection } from "./google-managed.ts";
import { registerGoogleCreatedResource } from "./google-resources.ts";
import { z } from "zod";
import { command,domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import type { ExternalTargetReference } from "../../lib/external/verification.ts";
import { externalTargetReference } from "../../lib/external/verification.ts";
import { executeAtomic,guardedUpdate,readStorage,requireInBatch } from "./atomic.ts";
import { readExternalOperation } from "./external-operation.ts";
import type { ExternalOperationRow } from "./external-operation.ts";

type TargetBinding=Readonly<{externalId:string;operationId:string|null;providerRequestId:string|null}>;
async function knownTarget(db:D1Database,owner:SiteIdentity,row:ExternalOperationRow):Promise<TargetBinding|null> {
  const snapshot=z.object({request:z.object({target:externalTargetReference.optional()}).passthrough()}).passthrough().parse(JSON.parse(row.snapshot));
  const target=snapshot.request.target;
  if(target?.source==="known") return {externalId:target.externalId,operationId:null,providerRequestId:null};
  if(target?.source==="operation") {
    const previous=await readStorage("external.target.predecessor",()=>db.prepare("SELECT id,external_id AS externalId FROM external_operations WHERE owner_id=? AND workflow_id=? AND business_key=? AND ordinal<? AND state='confirmed' AND external_id IS NOT NULL").bind(owner.userId,row.workflowId,target.businessKey,row.ordinal).all<{id:string;externalId:string}>());
    if(previous.results.length!==1) throw domainFailure("reference_conflict","external.target.unconfirmed-predecessor",null);
    return {externalId:previous.results[0].externalId,operationId:previous.results[0].id,providerRequestId:null};
  }
  const method:Readonly<Record<string,string>>={"folder-create":"drive.files.create","document-create":"docs.documents.create","sheet-create":"sheets.spreadsheets.create","calendar-create":"calendar.calendars.insert"};
  if(!Object.hasOwn(method,row.kind)) return null;
  const received=await readStorage("external.target.create-receipt",()=>db.prepare("SELECT q.id,q.result_external_id AS externalId FROM google_requests q JOIN external_attempt_records a ON a.owner_id=q.owner_id AND a.id=q.id JOIN external_workflows w ON w.owner_id=a.owner_id AND w.id=? WHERE a.owner_id=? AND a.operation_id=? AND a.mode='write' AND q.method=? AND q.state='succeeded' AND q.google_subject=w.google_subject AND q.result_external_id IS NOT NULL AND q.sent_at>=a.started_at").bind(row.workflowId,owner.userId,row.id,method[row.kind]).all<{id:string;externalId:string}>());
  if(received.results.length>1) throw domainFailure("reference_conflict","external.target.multiple-create-receipts",null);
  return received.results.length===1?{externalId:received.results[0].externalId,operationId:null,providerRequestId:received.results[0].id}:null;
}
/** 같은 작업의 앞선 확인 완료 단계 또는 서버가 저장한 ID만 참조합니다. */
export async function resolveExternalReference(db:D1Database,owner:SiteIdentity,row:ExternalOperationRow,value:ExternalTargetReference):Promise<string> {
  const reference=externalTargetReference.parse(value);if(reference.source==="known") return reference.externalId;
  const matches=await readStorage("external.target.reference",()=>db.prepare("SELECT external_id AS externalId FROM external_operations WHERE owner_id=? AND workflow_id=? AND business_key=? AND ordinal<? AND state='confirmed' AND external_id IS NOT NULL").bind(owner.userId,row.workflowId,reference.businessKey,row.ordinal).all<{externalId:string}>());
  if(matches.results.length!==1) throw domainFailure("reference_conflict","external.target.reference-unconfirmed",null);return matches.results[0].externalId;
}
/** 제목 검색 결과는 채택하지 않으며 확인된 앞 단계 또는 제공사 생성 영수증의 ID만 영속화합니다. */
export async function bindExternalTarget(db:D1Database,owner:SiteIdentity,row:ExternalOperationRow):Promise<ExternalOperationRow> {
  const binding:TargetBinding|null=await knownTarget(db,owner,row);
  if(binding===null) return row;
  if(binding.providerRequestId!==null) await recoverCreatedGrant(db,owner,row,binding);
  if(row.externalId!==null) {if(row.externalId!==binding.externalId) throw domainFailure("reference_conflict","external.target.changed",null);return row;}
  const context=command.parse({owner,requestKey:`target:${row.id}`,expectedVersion:row.version});
  await executeAtomic(db,context,"external.target.bind",binding,row.id,row.version+1,requestId=>[
    ...guardedUpdate(db,"external_operations",owner.userId,row.id,row.version,requestId,0,"external_id=?",[binding.externalId],"external_id IS NULL AND state!='running' AND state NOT IN ('confirmed','conflict')",[]),
    ...(binding.operationId===null?[]:[requireInBatch(db,owner.userId,requestId,1,"EXISTS(SELECT 1 FROM external_operations WHERE owner_id=? AND id=? AND workflow_id=? AND state='confirmed' AND external_id=?)",[owner.userId,binding.operationId,row.workflowId,binding.externalId])]),
    ...(binding.providerRequestId===null?[]:[requireInBatch(db,owner.userId,requestId,2,"EXISTS(SELECT 1 FROM google_requests WHERE owner_id=? AND id=? AND state='succeeded' AND result_external_id=?)",[owner.userId,binding.providerRequestId,binding.externalId])]),
  ]);
  return readExternalOperation(db,owner,row.id);
}

/** 생성 응답은 저장됐지만 앱 자원 등록이 중단된 경우 같은 연결 세대의 영수증으로만 복구합니다. */
async function recoverCreatedGrant(db:D1Database,owner:SiteIdentity,row:ExternalOperationRow,binding:TargetBinding):Promise<void> {
  const current=await readManagedGoogleConnection(db,owner);
  if(current===null || !["active","partial"].includes(current.state)) throw domainFailure("reference_conflict","external.target.connection",null);
  const role:"docs-target"|"sheets-target"|"calendar-target"|"folder-target"=row.kind==="folder-create"?"folder-target":row.kind==="document-create"?"docs-target":row.kind==="sheet-create"?"sheets-target":"calendar-target";
  if(role==="folder-target") {
    const receipt=await readStorage("external.target.folder-receipt",()=>db.prepare("SELECT q.finished_at AS finishedAt,EXISTS(SELECT 1 FROM google_report_folders f WHERE f.owner_id=q.owner_id AND f.id=q.id AND f.external_id=q.result_external_id) AS registered FROM google_requests q WHERE q.owner_id=? AND q.id=? AND q.connection_id=? AND q.generation=? AND q.state='succeeded' AND q.result_external_id=? AND q.finished_at IS NOT NULL").bind(owner.userId,binding.providerRequestId,current.connectionId,current.generation,binding.externalId).first<{finishedAt:number;registered:number}>());
    if(receipt===null) throw domainFailure("reference_conflict","external.target.folder-reapproval-required",null);
    if(receipt.registered===0) await registerGoogleCreatedResource(db,owner,current,binding.providerRequestId as string,binding.externalId,role,receipt.finishedAt);return;
  }
  const receipt=await readStorage("external.target.resource-receipt",()=>db.prepare("SELECT q.finished_at AS finishedAt,EXISTS(SELECT 1 FROM google_resources r WHERE r.owner_id=q.owner_id AND r.connection_id=q.connection_id AND r.generation=q.generation AND r.external_id=q.result_external_id AND r.role=?) AS registered FROM google_requests q WHERE q.owner_id=? AND q.id=? AND q.connection_id=? AND q.generation=? AND q.state='succeeded' AND q.result_external_id=? AND q.finished_at IS NOT NULL").bind(role,owner.userId,binding.providerRequestId,current.connectionId,current.generation,binding.externalId).first<{finishedAt:number;registered:number}>());
  if(receipt===null) throw domainFailure("reference_conflict","external.target.reapproval-required",null);
  if(receipt.registered===0) await registerGoogleCreatedResource(db,owner,current,binding.providerRequestId as string,binding.externalId,role,receipt.finishedAt);
}
