import { z } from "zod";
import { findGoogleReportDocument } from "../google-report/discovery.ts";
import type { GoogleReportSearch } from "../google-report/discovery.ts";
import { resolveGoogleReportDocument } from "../../db/repositories/google-report-document.ts";
import { resolveExternalReference } from "../../db/repositories/external-target.ts";
import { googleReportHeaders } from "../google-report/contract.ts";
import { verifyGoogleFile } from "../google/resources.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import type { GoogleExecutionResult } from "../google/execute.ts";
import type { GoogleRestInput } from "../google/rest-request.ts";
import type { GoogleResourceRole } from "../google/permissions.ts";
import { readGoogleExternalContract } from "./google-contract.ts";
import type { GoogleExternalContract } from "./google-contract.ts";
import { readGoogleDocumentObservation, googleDocumentObservation, googleSheetRowsObservation, googleEventObservation } from "./google-observation.ts";
import type { ExternalObservation } from "./verification.ts";
import type { ExternalCallContext, ExternalReadResult } from "./execute.ts";

export type GoogleObservationReader = Readonly<{ db: D1Database; owner: SiteIdentity; now: () => number; call: (context: ExternalCallContext, input: GoogleRestInput, role: GoogleResourceRole, requestId: string) => Promise<GoogleExecutionResult> }>;
export type ExternalContentConflict=Error & Readonly<{code:"external_content_conflict";reason:"precondition-mismatch"|"duplicate-business-key"|"unsupported-sheet-range"|"existing-event"}>;
export function conflict(reason:ExternalContentConflict["reason"]):ExternalContentConflict {return Object.assign(new Error("Google 대상의 현재 내용이 확정된 작업 조건과 달라요. 변경 내용을 확인해 주세요."),{name:"ExternalContentConflict",code:"external_content_conflict" as const,reason});}
export function targetId(context:ExternalCallContext):string {if(context.operation.externalId===null) throw new TypeError("외부 대상 ID를 확인하지 못했어요.");return context.operation.externalId;}
export async function readSheetRows(adapter:GoogleObservationReader,context:ExternalCallContext,sheetName:string,requestId:string):Promise<Readonly<{result:GoogleExecutionResult;observation:ExternalObservation}>> {
  const id:string=targetId(context);
  const metadata=await adapter.call(context,{method:"sheets.spreadsheets.get",spreadsheetId:id},"sheets-target",crypto.randomUUID());
  const parsed=z.object({spreadsheetId:z.literal(id),sheets:z.array(z.object({properties:z.object({title:z.string(),gridProperties:z.object({rowCount:z.number().int().positive(),columnCount:z.number().int().positive()})})})).min(1)}).parse(metadata.data);
  const tabs=parsed.sheets.filter(sheet=>sheet.properties.title===sheetName);
  if(tabs.length!==1 || tabs[0].properties.gridProperties.rowCount>1001 || tabs[0].properties.gridProperties.columnCount>100) throw conflict("unsupported-sheet-range");
  const endRow:number=Math.max(1000,tabs[0].properties.gridProperties.rowCount);
  const range:string=`'${sheetName.replaceAll("'","''")}'!A1:CV${endRow}`;
  const result=await adapter.call(context,{method:"sheets.values.get",spreadsheetId:id,range},"sheets-target",requestId);
  return {result,observation:googleSheetRowsObservation(result.data,id,sheetName,1,endRow)};
}
export async function discoverReportDocument(adapter:GoogleObservationReader,context:ExternalCallContext,request:Extract<GoogleExternalContract["request"],{kind:"document-create"}>):Promise<GoogleReportSearch|null> {
  if(!request.report)return null;const folderId=await resolveExternalReference(adapter.db,adapter.owner,context.operation,request.report.folder);
  return findGoogleReportDocument(folderId,request.report.businessKey,async input=>(await adapter.call(context,input,"folder-target",crypto.randomUUID())).data);
}
export async function readGoogleExternalOperation(adapter:GoogleObservationReader,context:ExternalCallContext):Promise<ExternalReadResult> {
  const {request,expected}:GoogleExternalContract=readGoogleExternalContract(context.operation);
  if(context.operation.externalId===null) {
    const found=request.kind==="document-create"?await discoverReportDocument(adapter,context,request):null;
    if(found?.state==="conflict")throw conflict("duplicate-business-key");
    return {receipt:null,observation:{status:"unavailable",reason:found?.state==="incomplete"?"incomplete-search":"missing-external-id"}};
  }
  const id:string=targetId(context);
  if(expected.kind==="file-placement" && (request.kind==="file-place" || request.kind==="file-placement-verify")) {
    const result=await adapter.call(context,{method:"drive.files.get",fileId:id},request.role,context.attemptId);
    verifyGoogleFile(result.data,id,request.role,adapter.now());
    const file=z.object({parents:z.array(z.string()).length(1),appProperties:z.object({alterBusinessKey:z.string()})}).parse(result.data);
    const parentId=await resolveExternalReference(adapter.db,adapter.owner,context.operation,request.parent);
    return {receipt:{id:result.attemptId,status:result.status},observation:{status:"available",externalId:id,content:{kind:"file-placement",parent:file.parents[0]===parentId?request.parent:{source:"known",externalId:file.parents[0]},parentId:file.parents[0],businessKey:file.appProperties.alterBusinessKey}}};
  }
  if(expected.kind==="folder") {
    const result=await adapter.call(context,{method:"drive.files.get",fileId:id},"folder-target",context.attemptId);
    const folder=z.object({id:z.literal(id),name:z.string(),mimeType:z.literal("application/vnd.google-apps.folder"),trashed:z.literal(false),isAppAuthorized:z.literal(true),capabilities:z.object({canEdit:z.literal(true)}),appProperties:z.object({alterBusinessKey:z.string()})}).parse(result.data);
    return {receipt:{id:result.attemptId,status:result.status},observation:{status:"available",externalId:id,content:{kind:"folder",title:folder.name,businessKey:folder.appProperties.alterBusinessKey}}};
  }
  if(expected.kind==="document") {
    const result=await adapter.call(context,{method:"docs.documents.get",documentId:id},"docs-target",context.attemptId);
    const document=readGoogleDocumentObservation(result.data,expected.tab);
    return {receipt:{id:result.attemptId,status:result.status},observation:googleDocumentObservation(document)};
  }
  if(expected.kind==="sheet") {
    const result=await adapter.call(context,{method:"sheets.spreadsheets.get",spreadsheetId:id},"sheets-target",context.attemptId);
    const sheet=z.object({spreadsheetId:z.string(),properties:z.object({title:z.string()})}).parse(result.data);
    return {receipt:{id:result.attemptId,status:result.status},observation:{status:"available",externalId:sheet.spreadsheetId,content:{kind:"sheet",title:sheet.properties.title}}};
  }
  if(expected.kind==="report-row" && "sheetName" in request) {
    const read=await readSheetRows(adapter,context,request.sheetName,context.attemptId);
    const observation=reportRows(read.observation);
    const documentId=await resolveGoogleReportDocument(adapter.db,adapter.owner,context.operation,expected.document);
    return {receipt:{id:read.result.attemptId,status:read.result.status},observation:{status:"available",externalId:id,content:{...observation,kind:"report-rows",document:expected.document,documentId}}};
  }
  if(expected.kind==="sheet-row" && "sheetName" in request) {
    const read=await readSheetRows(adapter,context,request.sheetName,context.attemptId);
    if((request.kind==="sheet-header-write" || request.kind==="sheet-header-verify") && (read.observation.status!=="available" || read.observation.content.kind!=="sheet-rows" || read.observation.content.rows[0]?.[expected.keyColumn]!==expected.businessKey)) throw conflict("precondition-mismatch");
    return {receipt:{id:read.result.attemptId,status:read.result.status},observation:read.observation};
  }
  if(expected.kind==="calendar") {
    const result=await adapter.call(context,{method:"calendar.calendars.get",calendarId:id},"calendar-target",context.attemptId);
    const calendar=z.object({id:z.string(),summary:z.string(),timeZone:z.string()}).parse(result.data);
    return {receipt:{id:result.attemptId,status:result.status},observation:{status:"available",externalId:calendar.id,content:{kind:"calendar",title:calendar.summary,timeZone:calendar.timeZone}}};
  }
  if(expected.kind==="calendar-event") {
    const result=await adapter.call(context,{method:"calendar.events.get",calendarId:id,eventId:expected.eventId},"calendar-target",context.attemptId);
    return {receipt:{id:result.attemptId,status:result.status},observation:googleEventObservation(result.data,id)};
  }
  throw new TypeError("외부 단계의 재조회 계약이 없습니다.");
}
export function reportRows(observation:ExternalObservation):Extract<Extract<ExternalObservation,{status:"available"}>["content"],{kind:"sheet-rows"}> {
  if(observation.status!=="available" || observation.content.kind!=="sheet-rows") throw conflict("unsupported-sheet-range");
  const first=observation.content.rows[0];
  if(!first || googleReportHeaders.some((value,index)=>first[index]!==value) || first.slice(googleReportHeaders.length).some(value=>value!=="")) throw conflict("precondition-mismatch");
  return observation.content;
}
