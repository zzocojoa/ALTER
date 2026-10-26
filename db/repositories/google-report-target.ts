import { z } from "zod";
import { recordId,domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleWeeklyReport } from "../../lib/google-report/contract.ts";
import type { GoogleWeeklyReport } from "../../lib/google-report/contract.ts";
import { externalExpected } from "../../lib/external/verification.ts";
import type { ExternalExpected } from "../../lib/external/verification.ts";
import { readStorage } from "./atomic.ts";
import { readManagedGoogleConnection } from "./google-managed.ts";

export type GoogleReportPredecessor=Readonly<{id:string;documentId:string;spreadsheetId:string;document:Extract<ExternalExpected,{kind:"document"}>;row:Extract<ExternalExpected,{kind:"report-row"}>}>;
export type GoogleReportTarget=Readonly<{existingId:string|null;predecessor:GoogleReportPredecessor|null}>;
/** 행 번호 대신 업무 키·마지막 검증 스냅샷을 연결하고 미확인 이전 작업은 우회하지 않습니다. */
export async function readGoogleReportTarget(db:D1Database,owner:SiteIdentity,value:GoogleWeeklyReport):Promise<GoogleReportTarget> {
  const report=googleWeeklyReport.parse(value);const connection=await readManagedGoogleConnection(db,owner);
  if(connection===null || !["active","partial"].includes(connection.state)) throw domainFailure("reference_conflict","google-report.connection-required",null);
  const raw=await readStorage("google-report.latest-workflow",()=>db.prepare("SELECT w.id,w.state,w.source_version AS sourceVersion,w.google_subject AS googleSubject FROM external_workflows w WHERE w.owner_id=? AND w.kind='weekly-export' AND w.target_key=? AND NOT EXISTS(SELECT 1 FROM external_workflows n WHERE n.owner_id=w.owner_id AND json_extract(n.snapshot,'$.predecessorId')=w.id) LIMIT 2").bind(owner.userId,report.businessKey).all());
  const rows=z.array(z.object({id:recordId,state:z.string(),sourceVersion:z.string(),googleSubject:z.string()}).strict()).max(2).parse(raw.results);
  if(rows.length===0) return {existingId:null,predecessor:null};
  if(rows.length!==1 || rows[0].googleSubject!==connection.googleSubject) throw domainFailure("reference_conflict","google-report.ambiguous-or-other-account",null);
  const latest=rows[0];if(latest.sourceVersion===report.versionId){if(latest.id!==report.jobId) throw domainFailure("reference_conflict","google-report.job-binding",null);return {existingId:latest.id,predecessor:null};}
  if(latest.state!=="confirmed") throw domainFailure("result_unknown","google-report.previous-unconfirmed",{id:latest.id});
  const operations=await readStorage("google-report.previous-verified-targets",()=>db.prepare("SELECT kind,external_id AS externalId,snapshot FROM external_operations WHERE owner_id=? AND workflow_id=? AND state='confirmed' AND kind IN ('document-write','report-row-append','report-row-update') ORDER BY ordinal").bind(owner.userId,latest.id).all<{kind:string;externalId:string|null;snapshot:string}>());
  const documents=operations.results.filter(item=>item.kind==="document-write");const sheets=operations.results.filter(item=>item.kind!=="document-write");
  if(documents.length!==1 || sheets.length!==1 || !documents[0].externalId || !sheets[0].externalId) throw domainFailure("reference_conflict","google-report.previous-target-proof",{id:latest.id});
  const document=externalExpected.parse(z.object({expected:z.unknown()}).parse(JSON.parse(documents[0].snapshot)).expected);const row=externalExpected.parse(z.object({expected:z.unknown()}).parse(JSON.parse(sheets[0].snapshot)).expected);
  if(document.kind!=="document" || row.kind!=="report-row") throw domainFailure("reference_conflict","google-report.previous-document-type",null);
  return {existingId:null,predecessor:{id:latest.id,documentId:documents[0].externalId,spreadsheetId:sheets[0].externalId,document,row}};
}
