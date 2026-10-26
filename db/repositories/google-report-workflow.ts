import { z } from "zod";
import { domainFailure,recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { readManagedGoogleConnection } from "./google-managed.ts";
import { readConfirmedGoogleReport } from "./weekly-export.ts";
import type { GoogleWeeklyReport } from "../../lib/google-report/contract.ts";
import { readGoogleReportTarget } from "./google-report-target.ts";
import { reserveGoogleReportSetup } from "./google-report-setup.ts";
import { prepareGoogleReportSetup } from "../../lib/google-report/setup.ts";
import { prepareGoogleReportDocument } from "../../lib/google-report/document.ts";
import { prepareGoogleReportRow,prepareGoogleReportRowUpdate } from "../../lib/google-report/row.ts";
import { createExternalWorkflow } from "./external-workflow.ts";
import { readExternalWorkflowView } from "../../lib/external/resume.ts";
import type { ExternalWorkflowView } from "../../lib/external/resume.ts";
import { readVerifiedGoogleReportDocument } from "./google-report-document.ts";
import { readStorage } from "./atomic.ts";
import { googleFileId } from "../../lib/google/resources.ts";

export type GoogleReportView=Readonly<{versionId:string;connected:boolean;workflow:ExternalWorkflowView|null;documentUrl:string|null;spreadsheetUrl:string|null}>;
async function reportView(db:D1Database,owner:SiteIdentity,report:GoogleWeeklyReport):Promise<GoogleReportView> {
  const connection=await readManagedGoogleConnection(db,owner);const connected:boolean=connection!==null && ["active","partial"].includes(connection.state) && connection.scopes.includes("https://www.googleapis.com/auth/drive.file");
  const exists=await readStorage("google-report.workflow",()=>db.prepare("SELECT id FROM external_workflows WHERE owner_id=? AND id=?").bind(owner.userId,report.jobId).first());
  if(exists===null)return {versionId:report.versionId,connected,workflow:null,documentUrl:null,spreadsheetUrl:null};
  const workflow=await readExternalWorkflowView(db,owner,report.jobId);const document=await readVerifiedGoogleReportDocument(db,owner,report);
  const rows=workflow.operations.filter(item=>["report-row-append","report-row-update"].includes(item.kind) && item.state==="confirmed");
  const spreadsheetUrl=rows.length===1 && rows[0].externalId!==null?`https://docs.google.com/spreadsheets/d/${googleFileId.parse(rows[0].externalId)}/edit`:null;
  return {versionId:report.versionId,connected,workflow,documentUrl:document?.url??null,spreadsheetUrl};
}
export async function readGoogleReportView(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,versionId:string):Promise<GoogleReportView> {return reportView(db,owner,await readConfirmedGoogleReport(db,bucket,owner,versionId));}

/** 사용자 확정으로 생성된 outbox를 실행 계획에 연결하며 연결 실패로 내부 확정본을 되돌리지 않습니다. */
export async function prepareGoogleReportWorkflow(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,versionId:string,now:number):Promise<GoogleReportView> {
  const report=await readConfirmedGoogleReport(db,bucket,owner,versionId);const current=await reportView(db,owner,report);
  if(!current.connected || current.workflow!==null)return current;
  const target=await readGoogleReportTarget(db,owner,report);if(target.existingId!==null)return reportView(db,owner,report);
  const setup=prepareGoogleReportSetup(await reserveGoogleReportSetup(db,owner,report,now));
  const document=prepareGoogleReportDocument(report,setup.folder,target.predecessor);
  const row=target.predecessor===null?prepareGoogleReportRow(report,setup.sheet,document.target):prepareGoogleReportRowUpdate(report,document.target,target.predecessor);
  await createExternalWorkflow(db,owner,`google-report:${versionId}`,{jobId:recordId.parse(report.jobId),kind:"weekly-export",targetKey:report.businessKey,sourceVersion:report.versionId,predecessorId:target.predecessor===null?null:recordId.parse(target.predecessor.id),operations:[...setup.operations,...document.operations,row]},now);
  return reportView(db,owner,report);
}

/** 저장된 주간 근거와 실제 R2 원본을 외부 요청 직전에 재검사합니다. */
export async function requireGoogleReportWorkflowCurrent(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,workflowId:string):Promise<void> {
  recordId.parse(workflowId);
  const row=await readStorage("google-report.current-job",()=>db.prepare("SELECT weekly_version_id AS versionId FROM external_jobs WHERE owner_id=? AND id=?").bind(owner.userId,workflowId).first());
  if(row===null)throw domainFailure("reference_conflict","external.resume.owner",null);
  const version=z.object({versionId:recordId.nullable()}).parse(row).versionId;
  if(version!==null)await readConfirmedGoogleReport(db,bucket,owner,version);
}
