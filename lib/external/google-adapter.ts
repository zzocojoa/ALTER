import { resolveExternalReference } from "../../db/repositories/external-target.ts";
import { verifyGoogleFile } from "../google/resources.ts";
import { conflict, targetId, reportRows, readSheetRows as readRows, discoverReportDocument as discoverDocument, readGoogleExternalOperation } from "./google-read.ts";
import type { GoogleObservationReader } from "./google-read.ts";
export type { ExternalContentConflict } from "./google-read.ts";
import type { GoogleReportSearch } from "../google-report/discovery.ts";
import { operationLease } from "../../db/repositories/external-operation.ts";
import { resolveGoogleReportDocument } from "../../db/repositories/google-report-document.ts";
import { googleReportDocumentUrl } from "../google-report/document.ts";
import { z } from "zod";
import { recordId } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { executeGoogleRestAttempt } from "../google/execute.ts";
import type { GoogleExecutionRuntime,GoogleExecutionSettings,GoogleExecutionResult } from "../google/execute.ts";
import type { GoogleRestInput } from "../google/rest-request.ts";
import type { GoogleResourceRole } from "../google/permissions.ts";
import { externalRetryExhausted } from "./retry.ts";
import { readGoogleExternalContract } from "./google-contract.ts";
import type { GoogleExternalContract } from "./google-contract.ts";
import { readGoogleDocumentObservation,googleDocumentObservation,googleEventObservation } from "./google-observation.ts";
import { verifyExternalContent } from "./verification.ts";
import type { ExternalExpected,ExternalObservation } from "./verification.ts";
import type { ExternalCallContext,ExternalTransport,ExternalWriteResult } from "./execute.ts";

type Adapter=Readonly<{db:D1Database;owner:SiteIdentity;settings:GoogleExecutionSettings;runtime:GoogleExecutionRuntime}>;
async function call(adapter:Adapter,context:ExternalCallContext,input:GoogleRestInput,role:GoogleResourceRole,requestId:string,storageUpperBytes:number):Promise<GoogleExecutionResult> {
  await context.beforeCall();
  const runtime:GoogleExecutionRuntime={...adapter.runtime,rest:{...adapter.runtime.rest,fetch:async(url,init)=>{
    await context.beforeCall();
    const remaining:number=(context.operation.leaseUntil??0)-adapter.runtime.rest.now();
    if(remaining<=0) throw externalRetryExhausted(context.operation.id,"deadline",context.operation.lastError);
    const timeout:AbortSignal=AbortSignal.timeout(remaining);
    return adapter.runtime.rest.fetch(url,{...init,signal:init.signal?AbortSignal.any([init.signal,timeout]):timeout});
  }}};
  return executeGoogleRestAttempt(adapter.db,adapter.owner,adapter.settings,input,{id:requestId,role,storageUpperBytes,selection:null,context:{attemptId:recordId.parse(context.attemptId),lease:operationLease(context.operation)}},runtime);
}
async function requireMatching(adapter:Adapter,expected:ExternalExpected,id:string,observation:ExternalObservation):Promise<void> {
  const proof=await verifyExternalContent(expected,id,observation,adapter.runtime.rest.now());
  if(proof.status!=="matched") throw conflict(proof.status==="conflict" && proof.reason==="duplicate-business-key"?"duplicate-business-key":"precondition-mismatch");
}
function readAccess(adapter: Adapter): GoogleObservationReader {
  return { db: adapter.db, owner: adapter.owner, now: adapter.runtime.rest.now, call: (context, input, role, requestId) => call(adapter, context, input, role, requestId, 0) };
}
async function readSheetRows(adapter: Adapter, context: ExternalCallContext, sheetName: string, requestId: string): Promise<Readonly<{ result: GoogleExecutionResult; observation: ExternalObservation }>> {
  return readRows(readAccess(adapter), context, sheetName, requestId);
}
async function discoverReportDocument(adapter: Adapter, context: ExternalCallContext, request: Extract<GoogleExternalContract["request"], { kind: "document-create" }>): Promise<GoogleReportSearch | null> {
  return discoverDocument(readAccess(adapter), context, request);
}
async function writeDocument(adapter:Adapter,context:ExternalCallContext,contract:GoogleExternalContract):Promise<GoogleExecutionResult> {
  if(contract.request.kind!=="document-write" || contract.expected.kind!=="document") throw new TypeError("문서 쓰기 계약이 아닙니다.");
  const id:string=targetId(context);
  const before=await call(adapter,context,{method:"docs.documents.get",documentId:id},"docs-target",crypto.randomUUID(),0);
  const document=readGoogleDocumentObservation(before.data,contract.request.base.tab);
  await requireMatching(adapter,contract.request.base,id,googleDocumentObservation(document));
  return call(adapter,context,{method:"docs.documents.batchUpdate",documentId:id,revisionId:document.revisionId,tabId:document.tabId,endIndex:document.bodyEndIndex,text:contract.expected.text},"docs-target",context.attemptId,new TextEncoder().encode(contract.expected.text).byteLength);
}
async function appendSheetRow(adapter:Adapter,context:ExternalCallContext,contract:GoogleExternalContract):Promise<GoogleExecutionResult> {
  if(contract.request.kind!=="sheet-row-append" || contract.expected.kind!=="sheet-row") throw new TypeError("성과표 행 추가 계약이 아닙니다.");
  const before=await readSheetRows(adapter,context,contract.request.sheetName,crypto.randomUUID());
  if(before.observation.status!=="available" || before.observation.content.kind!=="sheet-rows") throw conflict("unsupported-sheet-range");
  const expected=contract.expected;
  if(before.observation.content.rows.some(row=>row[expected.keyColumn]===expected.businessKey)) throw conflict("duplicate-business-key");
  if(before.observation.content.rows.length>=1000)throw conflict("unsupported-sheet-range");
  const nextRow:number=before.observation.content.rows.length+1;
  return call(adapter,context,{method:"sheets.values.append",spreadsheetId:targetId(context),range:`'${contract.request.sheetName.replaceAll("'","''")}'!A${nextRow}:CV${nextRow}`,values:[expected.values]},"sheets-target",context.attemptId,new TextEncoder().encode(JSON.stringify(expected.values)).byteLength);
}
async function appendReportRow(adapter:Adapter,context:ExternalCallContext,contract:GoogleExternalContract):Promise<GoogleExecutionResult> {
  if(contract.request.kind!=="report-row-append" || contract.expected.kind!=="report-row") throw new TypeError("주간 보고서 행 추가 계약이 아닙니다.");
  const expected=contract.expected;
  const documentId=await resolveGoogleReportDocument(adapter.db,adapter.owner,context.operation,expected.document);
  const before=await readSheetRows(adapter,context,contract.request.sheetName,crypto.randomUUID());const content=reportRows(before.observation);
  if(content.rows.some(row=>row[0]===expected.businessKey)) throw conflict("duplicate-business-key");
  if(content.rows.length>=1000) throw conflict("unsupported-sheet-range");
  const values=contract.expected.values.map((value,index)=>index===8?googleReportDocumentUrl(documentId):value);
  const nextRow:number=content.rows.length+1;
  return call(adapter,context,{method:"sheets.values.append",spreadsheetId:targetId(context),range:`'ALTER'!A${nextRow}:J${nextRow}`,values:[values]},"sheets-target",context.attemptId,new TextEncoder().encode(JSON.stringify(values)).byteLength);
}
/** Sheets에는 revision 조건 쓰기가 없어 사전 비교·앱 직렬화·사후 조회를 모두 적용합니다. */
async function updateReportRow(adapter:Adapter,context:ExternalCallContext,contract:GoogleExternalContract):Promise<GoogleExecutionResult> {
  if(contract.request.kind!=="report-row-update" || contract.expected.kind!=="report-row") throw new TypeError("주간 보고서 행 갱신 계약이 아닙니다.");
  const expected=contract.expected;const documentId=await resolveGoogleReportDocument(adapter.db,adapter.owner,context.operation,expected.document);
  const before=await readSheetRows(adapter,context,contract.request.sheetName,crypto.randomUUID());const content=reportRows(before.observation);
  await requireMatching(adapter,contract.request.base,targetId(context),before.observation);
  const position:number=content.startRow+content.rows.findIndex(row=>row[0]===expected.businessKey);
  const values=expected.values.map((value,index)=>index===8?googleReportDocumentUrl(documentId):value);
  return call(adapter,context,{method:"sheets.values.update",spreadsheetId:targetId(context),range:`'ALTER'!A${position}:J${position}`,values:[values]},"sheets-target",context.attemptId,new TextEncoder().encode(JSON.stringify(values)).byteLength);
}
async function placeFile(adapter:Adapter,context:ExternalCallContext,contract:GoogleExternalContract):Promise<GoogleExecutionResult> {
  const request=contract.request;if(request.kind!=="file-place") throw new TypeError("파일 배치 계약이 아닙니다.");
  const id=targetId(context);const parentId=await resolveExternalReference(adapter.db,adapter.owner,context.operation,request.parent);
  const before=await call(adapter,context,{method:"drive.files.get",fileId:id},request.role,crypto.randomUUID(),0);verifyGoogleFile(before.data,id,request.role,adapter.runtime.rest.now());
  const current=z.object({parents:z.array(z.string()).max(1),appProperties:z.object({alterBusinessKey:z.string().optional()}).optional()}).parse(before.data);
  if(current.appProperties?.alterBusinessKey && current.appProperties.alterBusinessKey!==request.businessKey) throw conflict("precondition-mismatch");
  return call(adapter,context,{method:"drive.files.update",fileId:id,parentId,previousParent:current.parents[0]===parentId?null:current.parents[0]??null,businessKey:request.businessKey},request.role,context.attemptId,4096);
}
async function writeSheetHeader(adapter:Adapter,context:ExternalCallContext,contract:GoogleExternalContract):Promise<GoogleExecutionResult> {
  if(contract.request.kind!=="sheet-header-write" || contract.expected.kind!=="sheet-row") throw new TypeError("성과표 열 설정 계약이 아닙니다.");
  const before=await readSheetRows(adapter,context,contract.request.sheetName,crypto.randomUUID());
  if(before.observation.status!=="available" || before.observation.content.kind!=="sheet-rows" || before.observation.content.rows.some(row=>row.some(cell=>cell!==""))) throw conflict("precondition-mismatch");
  return call(adapter,context,{method:"sheets.values.update",spreadsheetId:targetId(context),range:`'${contract.request.sheetName.replaceAll("'","''")}'!A1:J1`,values:[contract.expected.values]},"sheets-target",context.attemptId,new TextEncoder().encode(JSON.stringify(contract.expected.values)).byteLength);
}
async function writeEvent(adapter:Adapter,context:ExternalCallContext,contract:GoogleExternalContract):Promise<GoogleExecutionResult> {
  const {request,expected}=contract;
  if((request.kind!=="calendar-event-create" && request.kind!=="calendar-event-update") || expected.kind!=="calendar-event") throw new TypeError("일정 쓰기 계약이 아닙니다.");
  const calendarId:string=targetId(context);
  let before:GoogleExecutionResult|null=null;
  try {before=await call(adapter,context,{method:"calendar.events.get",calendarId,eventId:expected.eventId},"calendar-target",crypto.randomUUID(),0);}
  catch(error:unknown) {if(!(request.kind==="calendar-event-create" && error instanceof Error && "code" in error && error.code==="google_rest_failed" && "status" in error && error.status===404 && "reason" in error && error.reason==="not-found")) throw error;}
  const event={summary:expected.summary,description:expected.description,start:expected.start,end:expected.end,recurrence:expected.recurrence,businessKey:expected.businessKey};
  if(request.kind==="calendar-event-create") {
    if(before!==null) throw conflict("existing-event");
    return call(adapter,context,{method:"calendar.events.insert",calendarId,eventId:expected.eventId,event},"calendar-target",context.attemptId,4096);
  }
  if(before===null) throw conflict("precondition-mismatch");
  await requireMatching(adapter,request.base,calendarId,googleEventObservation(before.data,calendarId));
  const etag=z.object({etag:z.string().min(1)}).parse(before.data).etag;
  return call(adapter,context,{method:"calendar.events.update",calendarId,eventId:expected.eventId,etag,event},"calendar-target",context.attemptId,4096);
}
async function writeOperation(adapter:Adapter,context:ExternalCallContext):Promise<ExternalWriteResult> {
  const contract:GoogleExternalContract=readGoogleExternalContract(context.operation);
  const {request}=contract;
  let result:GoogleExecutionResult;
  switch(request.kind) {
    case "file-place":result=await placeFile(adapter,context,contract);break;
    case "folder-create":result=await call(adapter,context,{method:"drive.files.create",title:request.title,businessKey:request.businessKey},"folder-create",context.attemptId,4096);break;
    case "sheet-header-write":result=await writeSheetHeader(adapter,context,contract);break;
    case "document-create":{
      const found=await discoverReportDocument(adapter,context,request);
      if(found!==null && found.state!=="missing")throw conflict(found.state==="conflict"?"duplicate-business-key":"precondition-mismatch");
      result=await call(adapter,context,{method:"docs.documents.create",title:request.title},"docs-create",context.attemptId,65_536);break;
    }
    case "sheet-create":result=await call(adapter,context,{method:"sheets.spreadsheets.create",title:request.title},"sheets-create",context.attemptId,65_536);break;
    case "calendar-create":result=await call(adapter,context,{method:"calendar.calendars.insert",title:request.title},"calendar-create",context.attemptId,4096);break;
    case "document-write":result=await writeDocument(adapter,context,contract);break;
    case "report-row-update":result=await updateReportRow(adapter,context,contract);break;
    case "report-row-append":result=await appendReportRow(adapter,context,contract);break;
    case "sheet-row-append":result=await appendSheetRow(adapter,context,contract);break;
    case "calendar-event-create":case "calendar-event-update":result=await writeEvent(adapter,context,contract);break;
    case "folder-verify":case "file-placement-verify":case "sheet-header-verify":case "document-verify":case "sheet-row-verify":case "report-row-verify":case "calendar-event-verify":case "calendar-verify":throw new TypeError("조회 단계에 쓰기 실행을 요청했습니다.");
  }
  return {externalId:result.externalId??targetId(context),providerRequestId:result.attemptId,status:result.status};
}
export function googleExternalTransport(db:D1Database,owner:SiteIdentity,settings:GoogleExecutionSettings,runtime:GoogleExecutionRuntime):ExternalTransport {
  const adapter:Adapter={db,owner,settings,runtime};return {read:context=>readGoogleExternalOperation(readAccess(adapter),context),write:context=>writeOperation(adapter,context)};
}
