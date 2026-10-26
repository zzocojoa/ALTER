import { z } from "zod";
import type { ExternalOperationRow } from "./external-operation.ts";
import type { ExternalTargetReference } from "../../lib/external/verification.ts";
import { domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleWeeklyReport,googleWeeklyDocument } from "../../lib/google-report/contract.ts";
import type { GoogleWeeklyReport } from "../../lib/google-report/contract.ts";
import { googleDocumentLink,googleReportDocumentUrl } from "../../lib/google-report/document.ts";
import type { GoogleDocumentLink } from "../../lib/google-report/document.ts";
import { externalExpected } from "../../lib/external/verification.ts";
import { readStorage } from "./atomic.ts";

/** 실제 본문 재조회를 통과한 생성·갱신 단계의 링크만 공개합니다. */
export async function readVerifiedGoogleReportDocument(db:D1Database,owner:SiteIdentity,value:GoogleWeeklyReport):Promise<GoogleDocumentLink|null> {
  const report=googleWeeklyReport.parse(value);
  const rows=await readStorage("google-report.document-link",()=>db.prepare("SELECT o.external_id AS externalId,o.snapshot FROM external_operations o JOIN external_workflows w ON w.owner_id=o.owner_id AND w.id=o.workflow_id WHERE o.owner_id=? AND o.workflow_id=? AND w.source_version=? AND w.target_key=? AND o.kind='document-write' AND o.state='confirmed'").bind(owner.userId,report.jobId,report.versionId,report.businessKey).all<{externalId:string|null;snapshot:string}>());
  if(rows.results.length===0) return null;if(rows.results.length!==1 || rows.results[0].externalId===null) throw domainFailure("reference_conflict","google-report.document-proof-count",null);
  const row=rows.results[0];const expected=externalExpected.parse(z.object({expected:z.unknown()}).parse(JSON.parse(row.snapshot)).expected);
  if(expected.kind!=="document" || expected.title!==report.title || expected.text!==googleWeeklyDocument(report)) throw domainFailure("reference_conflict","google-report.document-proof-content",null);
  return googleDocumentLink.parse({documentId:row.externalId,url:googleReportDocumentUrl(row.externalId as string),verified:true});
}

/** 성과표 링크는 같은 작업에서 앞서 확인된 본문 쓰기의 실제 ID로만 해석합니다. */
export async function resolveGoogleReportDocument(db:D1Database,owner:SiteIdentity,operation:ExternalOperationRow,reference:ExternalTargetReference):Promise<string> {
  if(reference.source!=="operation") throw domainFailure("reference_conflict","google-report.document-operation-required",null);
  const row=await readStorage("google-report.document-reference",()=>db.prepare("SELECT external_id AS id FROM external_operations WHERE owner_id=? AND workflow_id=? AND business_key=? AND ordinal<? AND kind='document-write' AND state='confirmed' AND external_id IS NOT NULL").bind(owner.userId,operation.workflowId,reference.businessKey,operation.ordinal).first<{id:string}>());
  if(!row) throw domainFailure("reference_conflict","google-report.document-unconfirmed",null);return row.id;
}
