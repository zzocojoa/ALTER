import { z } from "zod";
import { command,contentHash,domainFailure,recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleWeeklyReport } from "../../lib/google-report/contract.ts";
import type { GoogleWeeklyReport } from "../../lib/google-report/contract.ts";
import { googleReportSetup } from "../../lib/google-report/setup.ts";
import type { GoogleReportSetup } from "../../lib/google-report/setup.ts";
import { readManagedGoogleConnection } from "./google-managed.ts";
import type { ManagedGoogleConnection } from "./google-managed.ts";
import { readGoogleResource } from "./google-resources.ts";
import { executeAtomic,isDomainFailure,readStorage,requireInBatch } from "./atomic.ts";

async function existingSetup(db:D1Database,owner:SiteIdentity,connection:ManagedGoogleConnection):Promise<GoogleReportSetup|null> {
  const raw=await readStorage("google-report.setup-read",()=>db.prepare("SELECT s.id,s.job_id AS jobId,w.state FROM google_report_setups s LEFT JOIN external_workflows w ON w.owner_id=s.owner_id AND w.id=s.job_id WHERE s.owner_id=? AND s.google_subject=?").bind(owner.userId,connection.googleSubject).first());
  if(raw===null) return null;
  const row=z.object({id:recordId,jobId:recordId,state:z.string().nullable()}).strict().parse(raw);
  if(row.state!=="confirmed") return {id:row.id,jobId:row.jobId,folderId:null,spreadsheetId:null,ready:false};
  const targets=await readStorage("google-report.setup-targets",()=>db.prepare("SELECT kind,external_id AS externalId,business_key AS businessKey FROM external_operations WHERE owner_id=? AND workflow_id=? AND state='confirmed' AND kind IN ('folder-create','sheet-create','sheet-header-write') ORDER BY ordinal").bind(owner.userId,row.jobId).all<{kind:string;externalId:string;businessKey:string}>());
  const folder=targets.results.filter(item=>item.kind==="folder-create" && item.businessKey===`setup:${row.id}:folder`);const sheet=targets.results.filter(item=>item.kind==="sheet-create" && item.businessKey===`setup:${row.id}:sheet`);const header=targets.results.filter(item=>item.kind==="sheet-header-write" && item.businessKey===`setup:${row.id}:header`);
  if(folder.length!==1 || sheet.length!==1 || header.length!==1 || sheet[0].externalId!==header[0].externalId) throw domainFailure("reference_conflict","google-report.setup-proof-missing",{id:row.id});
  await readGoogleResource(db,owner,connection,folder[0].externalId,"folder-target");await readGoogleResource(db,owner,connection,sheet[0].externalId,"sheets-target");
  return googleReportSetup.parse({id:row.id,jobId:row.jobId,folderId:folder[0].externalId,spreadsheetId:sheet[0].externalId,ready:true});
}
function setupForReport(setup:GoogleReportSetup,report:GoogleWeeklyReport):GoogleReportSetup {
  if(!setup.ready && setup.jobId!==report.jobId) throw domainFailure("result_unknown","google-report.finish-first-setup",{jobId:setup.jobId});
  return setup;
}
/** 동일 계정의 설정 실행을 최초 확정 작업 하나에 고정하며 중단 시 새 폴더 생성을 허용하지 않습니다. */
export async function reserveGoogleReportSetup(db:D1Database,owner:SiteIdentity,value:GoogleWeeklyReport,now:number):Promise<GoogleReportSetup> {
  const report=googleWeeklyReport.parse(value);const connection=await readManagedGoogleConnection(db,owner);
  if(connection===null || !["active","partial"].includes(connection.state)) throw domainFailure("reference_conflict","google-report.connection-required",null);
  const existing=await existingSetup(db,owner,connection);if(existing) return setupForReport(existing,report);
  const id=recordId.parse(crypto.randomUUID());const ctx=command.parse({owner,expectedVersion:1,requestKey:`report-setup:${await contentHash(connection.googleSubject)}`});
  try {await executeAtomic(db,ctx,"google-report.setup-reserve",{jobId:report.jobId,subject:connection.googleSubject},id,1,requestId=>[
    requireInBatch(db,owner.userId,requestId,0,"EXISTS(SELECT 1 FROM google_runtime r JOIN google_connections c ON c.owner_id=r.owner_id AND c.id=r.connection_id WHERE r.owner_id=? AND r.connection_id=? AND r.generation=? AND c.google_subject=? AND r.state IN ('active','partial'))",[owner.userId,connection.connectionId,connection.generation,connection.googleSubject]),
    requireInBatch(db,owner.userId,requestId,1,"EXISTS(SELECT 1 FROM weekly_snapshots p JOIN external_jobs j ON j.owner_id=p.owner_id AND j.id=p.export_job_id JOIN weekly_drafts d ON d.owner_id=p.owner_id AND d.summary_id=? WHERE p.owner_id=? AND p.id=? AND j.id=? AND j.weekly_version_id=p.id AND j.kind='weekly-export' AND j.state='pending' AND json_extract(d.content,'$.confirmedVersionId')=p.id AND json_extract(d.content,'$.phase')='confirmed')",[report.summaryId,owner.userId,report.versionId,report.jobId]),
    db.prepare("INSERT INTO google_report_setups VALUES (?,?,?,?,?)").bind(owner.userId,connection.googleSubject,id,report.jobId,now),
  ]);}catch(error:unknown){if(!isDomainFailure(error) || !["reference_conflict","request_key_reused","version_conflict"].includes(error.code)) throw error;const raced=await existingSetup(db,owner,connection);if(!raced) throw error;return setupForReport(raced,report);}
  return {id,jobId:report.jobId,folderId:null,spreadsheetId:null,ready:false};
}
