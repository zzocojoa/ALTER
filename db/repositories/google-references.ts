import { z } from "zod";
import { command,recordId,siteIdentity,timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleReferenceProof } from "../../lib/google-reference/contract.ts";
import type { GoogleReferenceProof } from "../../lib/google-reference/contract.ts";
import { requireGoogleReferenceSelection } from "../../lib/google-reference/read.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import { materialFailure,validateMaterialMetadata } from "../../lib/materials/policy.ts";
import type { MaterialMetadata } from "../../lib/materials/policy.ts";
import { readStorage,executeAtomic,requireInBatch,isDomainFailure } from "./atomic.ts";
import { getMaterialTransfer,materialTransferReservationStatements } from "./material-transfers.ts";
import type { StoredTransfer,TransferReservation } from "./material-transfers.ts";

/** 같은 읽기 ID는 다시 전송하지 않으며 실패나 유실 상태를 그대로 확인하게 합니다. */
export async function beginGoogleReferenceRead(db:D1Database,owner:SiteIdentity,id:string,fileId:string,now:number):Promise<void> {
  recordId.parse(id);timestamp.parse(now);const selected=await requireGoogleReferenceSelection(db,owner,fileId);
  const result=await db.prepare("INSERT INTO google_reference_reads SELECT ?,?,?,?,?,'reading',NULL,?,NULL WHERE EXISTS(SELECT 1 FROM google_runtime WHERE owner_id=? AND connection_id=? AND generation=? AND state IN ('active','partial')) ON CONFLICT(owner_id,id) DO NOTHING RETURNING id").bind(owner.userId,id,selected.connectionId,selected.generation,fileId,now,owner.userId,selected.connectionId,selected.generation).all<{id:string}>();
  if(!result.success || result.results.length!==1 || result.results[0].id!==id)throw googleFailure("google_request_unknown","reference-read-already-started");
}
export async function finishGoogleReferenceRead(db:D1Database,owner:SiteIdentity,id:string,value:GoogleReferenceProof,now:number):Promise<void> {
  recordId.parse(id);timestamp.parse(now);const proof=googleReferenceProof.parse(value);
  const result=await db.prepare("UPDATE google_reference_reads SET state='verified',proof=?,finished_at=? WHERE owner_id=? AND id=? AND file_id=? AND state='reading' AND created_at<=? AND EXISTS(SELECT 1 FROM google_runtime r WHERE r.owner_id=google_reference_reads.owner_id AND r.connection_id=google_reference_reads.connection_id AND r.generation=google_reference_reads.generation AND r.state IN ('active','partial')) RETURNING id").bind(JSON.stringify(proof),now,owner.userId,id,proof.fileId,now).all<{id:string}>();
  if(!result.success || result.results.length!==1 || result.results[0].id!==id)throw googleFailure("google_request_unknown","reference-proof-save");
}
export async function failGoogleReferenceRead(db:D1Database,owner:SiteIdentity,id:string,now:number):Promise<void> {
  recordId.parse(id);timestamp.parse(now);
  const result=await db.prepare("UPDATE google_reference_reads SET state='failed',finished_at=? WHERE owner_id=? AND id=? AND state='reading' RETURNING id").bind(now,owner.userId,id).all<{id:string}>();
  if(!result.success || result.results.length!==1 || result.results[0].id!==id)throw googleFailure("google_request_unknown","reference-failure-save");
}
const readRow=z.object({id:recordId,fileId:z.string(),state:z.enum(["reading","verified","failed"]),proof:z.string().nullable(),createdAt:timestamp,finishedAt:timestamp.nullable()}).strict();
export type GoogleReferenceReadView=Readonly<{id:string;fileId:string;state:"reading"|"verified"|"failed";proof:GoogleReferenceProof|null;createdAt:number;finishedAt:number|null}>;
export async function readGoogleReferenceRead(db:D1Database,owner:SiteIdentity,id:string):Promise<GoogleReferenceReadView> {
  recordId.parse(id);siteIdentity.parse(owner);
  const row=await readStorage("google.reference.read",()=>db.prepare("SELECT id,file_id AS fileId,state,proof,created_at AS createdAt,finished_at AS finishedAt FROM google_reference_reads WHERE owner_id=? AND id=?").bind(owner.userId,id).first());
  if(row===null)throw materialFailure("material_not_found","google-reference-read",404);
  const parsed=readRow.parse(row);return {...parsed,proof:parsed.proof===null?null:googleReferenceProof.parse(JSON.parse(parsed.proof))};
}
export function googleReferenceMaterialMetadata(proof:GoogleReferenceProof):MaterialMetadata {
  googleReferenceProof.parse(proof);const kind=proof.mime==="text/plain"?"text":proof.mime==="application/pdf"?"pdf":"image";
  const extension=proof.mime==="text/plain"?"txt":proof.mime==="application/pdf"?"pdf":proof.mime==="image/png"?"png":"jpg";
  return validateMaterialMetadata({title:proof.title,edition:`Google 원본 ${proof.driveVersion}`,role:"reference",kind,mime:proof.mime,filename:`Google-${proof.sha256.slice(0,16)}.${extension}`,bytes:proof.bytes,sha256:proof.sha256});
}
/** 출처와 사본 예약을 같은 batch로 확정하여 바이트·유형·원본 ID를 클라이언트가 바꿀 수 없게 합니다. */
export async function startGoogleReferenceImport(db:D1Database,owner:SiteIdentity,readId:string,courseId:string,now:number):Promise<StoredTransfer> {
  recordId.parse(readId);recordId.parse(courseId);timestamp.parse(now);
  const previous=await readStorage("google.reference.existing",()=>db.prepare("SELECT transfer_id FROM google_material_sources WHERE owner_id=? AND read_id=?").bind(owner.userId,readId).first<string>("transfer_id"));
  if(previous!==null){const transfer=await getMaterialTransfer(db,owner,previous);if(transfer.courseId!==courseId)throw materialFailure("material_version_conflict","google-import-course",409);return transfer;}
  const read=await readGoogleReferenceRead(db,owner,readId);if(read.state!=="verified" || read.proof===null)throw materialFailure("material_version_conflict","google-import-proof-unverified",409);
  const selected=await requireGoogleReferenceSelection(db,owner,read.fileId);
  const reservation:TransferReservation={id:recordId.parse(crypto.randomUUID()),materialId:recordId.parse(crypto.randomUUID()),uploadId:recordId.parse(crypto.randomUUID()),courseId:recordId.parse(courseId),metadata:googleReferenceMaterialMetadata(read.proof),now};
  try {
    await executeAtomic(db,command.parse({owner,requestKey:readId,expectedVersion:1}),"google.reference.import",{readId,courseId,reservation},reservation.id,1,requestId=>[
      ...materialTransferReservationStatements(db,owner,reservation,requestId),
      requireInBatch(db,owner.userId,requestId,1,"EXISTS(SELECT 1 FROM google_reference_reads g JOIN google_runtime r ON r.owner_id=g.owner_id AND r.connection_id=g.connection_id AND r.generation=g.generation WHERE g.owner_id=? AND g.id=? AND g.connection_id=? AND g.generation=? AND g.state='verified' AND r.state IN ('active','partial'))",[owner.userId,readId,selected.connectionId,selected.generation]),
      db.prepare("INSERT INTO google_material_sources VALUES (?,?,?,?,?)").bind(owner.userId,readId,reservation.id,reservation.materialId,now),
    ]);
  }catch(error:unknown){
    if(!isDomainFailure(error) || !["version_conflict","request_key_reused","reference_conflict"].includes(error.code))throw error;
    const concurrent=await readStorage("google.reference.concurrent",()=>db.prepare("SELECT transfer_id FROM google_material_sources WHERE owner_id=? AND read_id=?").bind(owner.userId,readId).first<string>("transfer_id"));
    if(concurrent===null)throw error;const transfer=await getMaterialTransfer(db,owner,concurrent);if(transfer.courseId!==courseId)throw error;return transfer;
  }
  return getMaterialTransfer(db,owner,reservation.id);
}

export async function readGoogleMaterialSource(db:D1Database,owner:SiteIdentity,materialId:string):Promise<GoogleReferenceProof|null> {
  recordId.parse(materialId);
  const row=await readStorage("google.reference.source",()=>db.prepare("SELECT r.proof FROM google_material_sources s JOIN google_reference_reads r ON r.owner_id=s.owner_id AND r.id=s.read_id WHERE s.owner_id=? AND s.material_id=? AND r.state='verified'").bind(owner.userId,materialId).first<string>("proof"));
  return row===null?null:googleReferenceProof.parse(JSON.parse(row));
}
export async function listGoogleReferences(db:D1Database,owner:SiteIdentity):Promise<Readonly<{files:readonly Readonly<{id:string;name:string;mimeType:string}>[];hasMore:boolean}>> {
  const rows=await readStorage("google.reference.list",()=>db.prepare("SELECT f.external_id AS id,json_extract(f.metadata,'$.name') AS name,json_extract(f.metadata,'$.mimeType') AS mimeType FROM google_resources f JOIN google_runtime r ON r.owner_id=f.owner_id AND r.connection_id=f.connection_id AND r.generation=f.generation WHERE f.owner_id=? AND f.role='reference' AND f.source='picker' AND r.state IN ('active','partial') ORDER BY f.approved_at DESC,f.id DESC LIMIT 101").bind(owner.userId).all());
  const files=z.array(z.object({id:z.string(),name:z.string(),mimeType:z.string()}).strict()).parse(rows.results);return {files:files.slice(0,100),hasMore:files.length>100};
}
