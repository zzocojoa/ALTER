import pdfDecoder from "../../lib/materials/pdf-wasm/validator.wasm";
import jpegDecoder from "../../lib/materials/jpeg-wasm/decoder.wasm";
import { downloadGoogleReference } from "../../lib/google-reference/download.ts";
import { readGoogleReferenceRead,startGoogleReferenceImport,readGoogleMaterialSource } from "../../db/repositories/google-references.ts";
import { recordId } from "../../lib/domain/contracts.ts";
import { createCourse } from "../../db/repositories/courses.ts";
import { initializeMaterialInventory,getMaterialTransfer } from "../../db/repositories/material-transfers.ts";
import { materialPolicy } from "../../lib/materials/policy.ts";
import type { MaterialRuntimeEvidence } from "../../lib/materials/policy.ts";
import { uploadMaterialBody } from "../../lib/materials/upload.ts";
import { completeMaterialTransfer } from "../../lib/materials/complete.ts";
import { materialFileReference } from "../../lib/materials/attachment.ts";
import { buildSelection } from "../../lib/extraction/selection.ts";
import { saveExtractionSelection,getExtractionJob } from "../../db/repositories/extraction-jobs.ts";
import { readMaterialLibrary } from "../../lib/materials/library.ts";
import { createHash } from "node:crypto";
import { fixtureGoogleConnection } from "./google-connected.ts";
import { fixtureGoogleProject } from "./google-project.ts";
import { fixtureGoogleQuota } from "./google-quota.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";
import { googleQuotaPolicy } from "../../lib/google/quota.ts";
import { googleMethodPolicies } from "../../lib/google/permissions.ts";
import { executeGoogleRestAttempt } from "../../lib/google/execute.ts";
import type { GoogleExecutionSettings,GoogleExecutionRuntime } from "../../lib/google/execute.ts";
import { saveGoogleStorageObservation } from "../../db/repositories/google-observations.ts";
import { saveGooglePickerLease,consumeGooglePickerLease,registerGoogleSelectedFile } from "../../db/repositories/google-resources.ts";
import { googlePickerCredentials,googlePickerSelection } from "../../lib/google/picker.ts";
import { verifyGoogleFile } from "../../lib/google/resources.ts";
import { readGoogleReference } from "../../lib/google-reference/read.ts";
import type { GoogleReferenceProof } from "../../lib/google-reference/contract.ts";
import { readablePdf } from "./pdf-bytes.ts";
import { pngSource,pngImage } from "./png-bytes.ts";

function ensure(value:boolean,message:string):void {if(!value)throw new Error(message);}
async function denied(action:()=>Promise<unknown>,code:string):Promise<void> {try{await action();}catch(error:unknown){if(error instanceof Error && ("code" in error && error.code===code || error.name===code))return;throw error;}throw new Error(`거부 누락: ${code}`);}
export async function checkGoogleReferences(db:D1Database,bucket:R2Bucket):Promise<readonly string[]> {
  const now:number=Date.now();const fixed=await fixtureGoogleConnection(db,"reference-owner",now);const owner=fixed.owner;const base=fixtureGoogleQuota(owner.userId,now,10000,10000);
  const quota=googleQuotaPolicy.parse({...base,apis:["drive","docs","sheets","calendar"].map(api=>({...base.apis[0],api,dimensions:base.apis[0].dimensions.map(d=>({...d,metric:"request-minute",unit:"requests",actions:["read","write","create"]}))})),methods:Object.entries(googleMethodPolicies).filter(([method])=>method!=="picker.open").map(([method,policy])=>({method,source:policy.source,costs:[{metric:"request-minute",scope:"project",units:1},{metric:"request-minute",scope:"user",units:1}]}))});
  const settings:GoogleExecutionSettings={credentials:{clientId:fixtureGoogleOAuth(now).clientId,clientSecret:"fixed-secret",keyring:fixed.keyring},project:{...fixtureGoogleProject(now),ownerId:owner.userId,projectId:quota.projectId,consoleSource:`https://console.cloud.google.com/apis/dashboard?project=${quota.projectId}`},quota};
  const pdf=readablePdf(1);const png=pngImage({width:1,height:1,depth:8,color:2,interlace:0},new Uint8Array([0,255,0,0]));
  const file=(id:string,mime:string,size:number|null):Record<string,unknown>=>({id,name:`시험 ${id}`,mimeType:mime,version:"1",modifiedTime:"2026-10-25T00:00:00Z",trashed:false,isAppAuthorized:true,capabilities:{canEdit:true,canDownload:true},...(size===null?{}:{size:String(size)})});
  const files=new Map<string,Record<string,unknown>>([["selected-doc",file("selected-doc","application/vnd.google-apps.document",null)],["selected-pdf",file("selected-pdf","application/pdf",pdf.length)],["selected-png",file("selected-png","image/png",null)],["selected-sheet",file("selected-sheet","application/vnd.google-apps.spreadsheet",null)]]);
  const proofs:GoogleReferenceProof[]=[];let requests:number=0;let changed:boolean=false;let interrupted:boolean=false;let revoked:boolean=false;let unsupported:boolean=false;let oversized:boolean=false;
  const runtime:GoogleExecutionRuntime={oauth:{fetch:async()=>{throw new Error("예상하지 않은 OAuth");},now:()=>now,wait:async()=>{throw new Error("예상하지 않은 대기");},warn:()=>{}},rest:{now:()=>now,wait:async()=>{throw new Error("예상하지 않은 재시도");},warn:()=>{},fetch:async(raw,init)=>{
    requests+=1;ensure(init.method==="GET","참고 자료 외부 쓰기 발생");const url=new URL(raw);const id=url.pathname.split("/").at(-1)??"";
    if(url.pathname==="/drive/v3/about")return Response.json({storageQuota:{limit:"100000000",usage:"0"}});
    if(revoked)return Response.json({error:{errors:[{reason:"insufficientPermissions"}]}},{status:403});
    if(url.searchParams.get("alt")==="media"){
      if(changed){const current=files.get(id);if(!current)throw new Error("변경 대상 없음");files.set(id,{...current,version:"2"});}
      if(interrupted)return new Response(new ReadableStream({type:"bytes",pull(controller:ReadableByteStreamController):void{controller.error(new TypeError("다운로드 중단 시험"));}}),{headers:{"content-type":"application/pdf"}});
      return new Response(pngSource(oversized?new Uint8Array(8_388_609):id==="selected-pdf"?pdf:png,4096),{headers:{"content-type":id==="selected-pdf"?"application/pdf":"image/png"}});
    }
    if(url.hostname==="docs.googleapis.com") {
      const cell=(text:string):Readonly<{content:readonly unknown[]}>=>( {content:[{paragraph:{elements:[{textRun:{content:text}}]}}]} );
      return Response.json({documentId:id,revisionId:"revision-1",tabs:[{tabProperties:{tabId:"t.0",title:"첫 탭"},documentTab:{body:{content:[
        {paragraph:{elements:unsupported?[{inlineObjectElement:{inlineObjectId:"image"}}]:[{textRun:{content:"분수는 전체의 일부입니다.\n"}}]}},
        {table:{tableRows:[{tableCells:[cell("분자\n"),cell("분모\n")]}]}},
      ]}}}]});
    }
    const metadata=files.get(id);if(!metadata)return Response.json({error:{errors:[{reason:"notFound"}]}},{status:404});return Response.json(metadata);
  }}};
  const probe=await executeGoogleRestAttempt(db,owner,settings,{method:"drive.about.get"},{id:crypto.randomUUID(),role:"account",storageUpperBytes:0,selection:null,context:null},runtime);await saveGoogleStorageObservation(db,owner,fixed.connection,probe.attemptId,quota.projectId,probe.data,now);
  for(const [id,metadata] of files){const credentials=googlePickerCredentials.parse({leaseId:crypto.randomUUID(),connectionId:fixed.connection.connectionId,generation:1,projectNumber:"123456789",origin:"https://alter.example.test",apiKey:"fixture-api-key-not-real",accessToken:"fixture-access",tokenExpiresAt:now+3_600_000,leaseExpiresAt:now+60_000});await saveGooglePickerLease(db,owner,credentials,"reference",now);const selection=googlePickerSelection.parse({leaseId:credentials.leaseId,connectionId:credentials.connectionId,generation:1,fileId:id,role:"reference"});await consumeGooglePickerLease(db,owner,selection,now);await registerGoogleSelectedFile(db,owner,selection,verifyGoogleFile(metadata,id,"reference",now),now);}
  const successful:Readonly<{id:string;bytes:Uint8Array}>[]=[];
  const read=async(fileId:string):Promise<Uint8Array>=>{const id=crypto.randomUUID();const result=await downloadGoogleReference(db,owner,settings,id,fileId,runtime);const bytes=new Uint8Array(await new Response(result.body).arrayBuffer());const saved=await readGoogleReferenceRead(db,owner,id);if(saved.state!=="verified" || saved.proof===null)throw new Error("읽기 증거 미확정");proofs.push(saved.proof);successful.push({id,bytes});return bytes;};
  const beforeDenied=requests;await denied(()=>read("unselected-id"),"google_scope_denied");await denied(()=>read("https://evil.invalid/file"),"ZodError");await denied(()=>readGoogleReference(db,{realm:"sites",userId:"another-owner"},settings,"selected-doc",runtime,async()=>{}),"google_connection_unavailable");ensure(requests===beforeDenied,"미선택·다른 소유자 파일에서 외부 호출");
  const docs=new TextDecoder().decode(await read("selected-doc"));ensure(docs.includes("첫 탭") && docs.includes("분자\t분모") && proofs[0].documentRevision==="revision-1","Docs 구조·출처 누락");
  ensure(createHash("sha256").update(await read("selected-pdf")).digest("hex")===createHash("sha256").update(pdf).digest("hex"),"PDF 바이트 불일치");
  ensure(createHash("sha256").update(await read("selected-png")).digest("hex")===createHash("sha256").update(png).digest("hex"),"PNG 바이트 불일치");ensure(proofs.slice(1).every(p=>p.maximumReadBufferBytes<=65536),"서버 읽기 버퍼 초과");
  const completed=proofs.length;await denied(()=>read("selected-sheet"),"material_type_mismatch");unsupported=true;await denied(()=>read("selected-doc"),"material_content_invalid");unsupported=false;
  changed=true;await denied(()=>read("selected-pdf"),"material_version_conflict");changed=false;interrupted=true;await denied(()=>read("selected-pdf"),"TypeError");interrupted=false;
  oversized=true;await denied(()=>read("selected-png"),"material_size_exceeded");oversized=false;revoked=true;await denied(()=>read("selected-doc"),"google_rest_failed");revoked=false;
  const beforeWrite=requests;await denied(()=>executeGoogleRestAttempt(db,owner,settings,{method:"docs.documents.batchUpdate",documentId:"selected-doc",revisionId:"v1",tabId:"t.0",endIndex:2,text:"허용되지 않은 쓰기"},{id:crypto.randomUUID(),role:"reference",storageUpperBytes:4096,selection:null,context:null},runtime),"google_scope_denied");ensure(requests===beforeWrite && proofs.length===completed,"참고 자료 쓰기·불완전한 결과 확정");
  ensure((await db.prepare("SELECT count(*) AS n FROM google_requests WHERE owner_id=? AND sent_at IS NOT NULL").bind(owner.userId).first<{n:number}>())?.n===requests,"참고 자료 요청 집계 누락");
  const courseId=recordId.parse(crypto.randomUUID());await createCourse(db,{owner,requestKey:crypto.randomUUID(),expectedVersion:1},{id:courseId,title:"Google 가져오기 검증"});
  const evidence:MaterialRuntimeEvidence={policyVersion:materialPolicy.version,deploymentId:"google-reference-fixture",checkedAt:now,validUntil:now+3600000,acceptedBodyBytes:20971520,maximumBufferedBytes:65536,workerMemoryLimitBytes:134217728,contentValidation:{pdf:true,image:true,text:true},privateRangeReadVerified:true,storageVerification:materialPolicy.storageVerification,r2WriteReadVerified:true,accountRemainingQuota:"unavailable",additionalPaidResources:false};
  await initializeMaterialInventory(db,{owner,requestKey:crypto.randomUUID(),expectedVersion:1},crypto.randomUUID(),0,evidence,now);
  const countMaterials=async():Promise<number>=>await db.prepare("SELECT count(*) AS n FROM materials WHERE owner_id=?").bind(owner.userId).first<number>("n")??0;
  const first=successful[0];await db.prepare("CREATE TRIGGER fixture_google_source_save_failure BEFORE INSERT ON google_material_sources BEGIN SELECT RAISE(ABORT,'invalid_fixture_google_source'); END").run();
  await denied(()=>startGoogleReferenceImport(db,owner,first.id,courseId,now),"reference_conflict");ensure(await countMaterials()===0,"출처 저장 실패 후 자료 부분 커밋");await db.prepare("DROP TRIGGER fixture_google_source_save_failure").run();
  for(const copy of successful){
    const races=await Promise.all([startGoogleReferenceImport(db,owner,copy.id,courseId,now),startGoogleReferenceImport(db,owner,copy.id,courseId,now)]);const transfer=races[0];ensure(transfer.id===races[1].id,"사본 동시 예약 중복");
    const uploaded=await uploadMaterialBody(db,bucket,owner,transfer.id,transfer.version,new Request("https://local.invalid/upload",{method:"PUT",headers:{"content-type":transfer.metadata.mime},body:pngSource(copy.bytes,4096)}));
    const registered=await completeMaterialTransfer(db,bucket,owner,transfer.id,uploaded.version,{pdf:pdfDecoder,jpeg:jpegDecoder},new AbortController().signal);const saved=await getMaterialTransfer(db,owner,transfer.id);
    const original=await readGoogleReferenceRead(db,owner,copy.id);const source=await readGoogleMaterialSource(db,owner,registered.materialId);ensure(source?.sha256===original.proof?.sha256 && source?.bytes===saved.metadata.bytes && source?.driveVersion===original.proof?.driveVersion,"사본 출처 연결 불일치");
    ensure((await startGoogleReferenceImport(db,owner,copy.id,courseId,now)).id===transfer.id,"등록 재시도 중복");
    const selection=buildSelection(materialFileReference(saved),"","1");await saveExtractionSelection(db,{owner,requestKey:crypto.randomUUID(),expectedVersion:0},saved,selection);ensure((await getExtractionJob(db,owner,saved.materialId))?.selection.originalHash===source?.sha256,"기존 선택 페이지 연결 실패");
  }
  const library=await readMaterialLibrary(db,owner,null);ensure(library.materials.length===3 && library.materials.every(item=>item.googleSource?.fileId),"보관함 출처 누락");
  await denied(()=>db.prepare("UPDATE google_reference_reads SET proof='{}' WHERE owner_id=? AND id=?").bind(owner.userId,first.id).run(),"Error");
  await denied(()=>startGoogleReferenceImport(db,{realm:"sites",userId:"other-import-owner"},first.id,courseId,now),"material_not_found");
  const failed=await db.prepare("SELECT id FROM google_reference_reads WHERE owner_id=? AND state='failed' LIMIT 1").bind(owner.userId).first<string>("id");if(!failed)throw new Error("중단된 읽기 원장 없음");await denied(()=>startGoogleReferenceImport(db,owner,failed,courseId,now),"material_version_conflict");
  const callsBeforeImportRetry=requests;await startGoogleReferenceImport(db,owner,first.id,courseId,now);ensure(requests===callsBeforeImportRetry,"등록 재개가 Google 읽기 반복");
  ensure((await db.prepare("SELECT count(*) AS n FROM ai_calls WHERE owner_id=?").bind(owner.userId).first<number>("n"))===0,"자료 읽기가 AI 자동 호출");
  return ["reference-picker-only-unselected-url-other-owner-zero-requests","reference-docs-tabs-table-text-and-revision","reference-pdf-png-stream-byte-hash-and-64k-buffer","reference-unsupported-docs-content-never-silently-omitted","reference-unsupported-file-type-denied","reference-source-changed-during-download-not-confirmed","reference-interrupted-download-no-proof-no-retry","reference-unknown-size-enforced-while-streaming","reference-provider-revoked-permission-denied","reference-write-rejected-before-network","reference-all-metadata-content-and-readbacks-counted","reference-import-source-failure-atomic-rollback","reference-import-concurrent-one-reservation-and-replay","reference-docs-pdf-image-existing-r2-content-validation","reference-import-source-hash-version-and-library-persistence","reference-import-existing-selected-page-binding","reference-import-failed-other-owner-and-proof-edit-denied","reference-import-resume-no-google-reread-no-ai-call"];
}
