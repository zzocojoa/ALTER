import { createHash } from "node:crypto";
import { readGoogleResource } from "../../db/repositories/google-resources.ts";
import { readManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { materialFailure } from "../materials/policy.ts";
import { googleFailure } from "../google/errors.ts";
import { executeGoogleRest } from "../google/execute.ts";
import type { GoogleExecutionRuntime,GoogleExecutionSettings } from "../google/execute.ts";
import { googleFileId,verifyGoogleFile } from "../google/resources.ts";
import { googleReferenceMetadata,googleReferenceFormat,requireUnchangedGoogleReference } from "./contract.ts";
import type { GoogleReferenceMetadata,GoogleReferenceProof } from "./contract.ts";
import { readGoogleReferenceDocument } from "./document.ts";
import { openGoogleReferenceMedia } from "./media.ts";

/** Picker 선택 근거가 현재 계정·세대에 없으면 토큰 갱신이나 파일 조회 전 중단합니다. */
export async function requireGoogleReferenceSelection(db:D1Database,owner:SiteIdentity,fileId:string):Promise<Readonly<{connectionId:string;generation:number}>> {
  googleFileId.parse(fileId);
  const hidden=await db.prepare("SELECT 1 FROM attempts WHERE owner_id=? AND status='awaiting-answer' AND hidden_material=1 LIMIT 1").bind(owner.userId).first();
  if(hidden!==null)throw materialFailure("material_access_required","material-hidden-during-recall",403);
  const connection=await readManagedGoogleConnection(db,owner);
  if(connection===null || !["active","partial"].includes(connection.state))throw googleFailure("google_connection_unavailable","reference-selection");
  const selected=await readGoogleResource(db,owner,connection,fileId,"reference");if(selected.source!=="picker")throw googleFailure("google_scope_denied","reference-picker-required");
  return {connectionId:connection.connectionId,generation:connection.generation};
}
async function readMetadata(db:D1Database,owner:SiteIdentity,settings:GoogleExecutionSettings,fileId:string,runtime:GoogleExecutionRuntime):Promise<GoogleReferenceMetadata> {
  await requireGoogleReferenceSelection(db,owner,fileId);
  const response=await executeGoogleRest(db,owner,settings,{method:"drive.files.get",fileId},{id:crypto.randomUUID(),role:"reference",storageUpperBytes:0,selection:null,context:null},runtime);
  verifyGoogleFile(response.data,fileId,"reference",runtime.rest.now());return googleReferenceMetadata.parse(response.data);
}
/** 원문은 Google이 발급한 ID로만 읽고 읽기 전후의 버전과 권한을 대조합니다. */
export async function readGoogleReference(db:D1Database,owner:SiteIdentity,settings:GoogleExecutionSettings,fileId:string,runtime:GoogleExecutionRuntime,complete:(proof:GoogleReferenceProof)=>Promise<void>):Promise<Readonly<{body:ReadableStream<Uint8Array>;mime:GoogleReferenceProof["mime"]}>> {
  const initial=await requireGoogleReferenceSelection(db,owner,fileId);const before=await readMetadata(db,owner,settings,fileId,runtime);const format=googleReferenceFormat(before);
  const finish=async(proof:Readonly<{bytes:number;sha256:string;maximumReadBufferBytes:number}>,revision:string|null):Promise<void>=>{
    const after=await readMetadata(db,owner,settings,fileId,runtime);requireUnchangedGoogleReference(before,after);
    const current=await requireGoogleReferenceSelection(db,owner,fileId);if(current.connectionId!==initial.connectionId || current.generation!==initial.generation)throw googleFailure("google_connection_unavailable","reference-generation-changed");
    await complete({...proof,fileId,title:before.name,modifiedTime:before.modifiedTime,driveVersion:before.version,sourceMime:before.mimeType,sourceUrl:`https://drive.google.com/file/d/${fileId}/view`,mime:format.mime,documentRevision:revision});
  };
  if(format.kind==="text"){
    const result=await executeGoogleRest(db,owner,settings,{method:"docs.documents.get",documentId:fileId},{id:crypto.randomUUID(),role:"reference",storageUpperBytes:0,selection:null,context:null},runtime);
    const document=readGoogleReferenceDocument(result.data,fileId);const bytes=new TextEncoder().encode(document.text);
    await finish({bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),maximumReadBufferBytes:bytes.byteLength},document.revision);
    const response=new Response(bytes);if(response.body===null)throw new TypeError("Google Docs 본문 스트림 없음");return {body:response.body,mime:format.mime};
  }
  if(format.mime==="text/plain")throw new TypeError("Google 바이너리 유형 불일치");
  const body=await openGoogleReferenceMedia(db,owner,settings,{method:"drive.files.get-media",fileId,mime:format.mime,maximumBytes:format.expectedBytes===null?format.maximumBytes:Math.max(65_536,format.expectedBytes),expectedBytes:format.expectedBytes},runtime,proof=>finish(proof,null));return {body,mime:format.mime};
}
