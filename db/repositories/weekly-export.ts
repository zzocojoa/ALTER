import { z } from "zod";
import { domainFailure,recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { prepareGoogleWeeklyReport } from "../../lib/google-report/contract.ts";
import type { GoogleWeeklyReport } from "../../lib/google-report/contract.ts";
import { readWeeklyFrozen } from "./weekly-confirmation.ts";
import { readWeeklyWorkspace } from "./weekly-workspace.ts";
import { readStorage } from "./atomic.ts";

/** 소유자·현재 근거·최신 확정판을 읽으며 Google 연결 여부와 무관하게 내부 기록을 보존합니다. */
export async function readConfirmedGoogleReport(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,versionId:string):Promise<GoogleWeeklyReport> {
  recordId.parse(versionId);const frozen=await readWeeklyFrozen(db,bucket,owner,versionId);
  const latest=await readWeeklyWorkspace(db,owner,frozen.state.id);
  if(!frozen.current || latest.phase!=="confirmed" || latest.confirmedVersionId!==versionId || latest.version!==frozen.state.version) throw domainFailure("version_conflict","google-report.latest-confirmed-required",{versionId});
  const raw=await readStorage("google-report.outbox",()=>db.prepare("SELECT p.export_job_id AS jobId,j.weekly_version_id AS versionId FROM weekly_snapshots p JOIN external_jobs j ON j.owner_id=p.owner_id AND j.id=p.export_job_id JOIN weekly_summaries s ON s.owner_id=p.owner_id AND s.id=? WHERE p.owner_id=? AND p.id=? AND j.kind='weekly-export' AND NOT EXISTS(SELECT 1 FROM weekly_versions v JOIN weekly_summaries other ON other.owner_id=v.owner_id AND other.id=v.summary_id WHERE v.owner_id=p.owner_id AND other.course_id=s.course_id AND other.period_start=s.period_start AND v.id!=p.id AND v.confirmed_at>=p.confirmed_at)").bind(frozen.state.id,owner.userId,versionId).first());
  if(!raw) throw domainFailure("version_conflict","google-report.latest-business-version",{versionId});
  const row=z.object({jobId:recordId,versionId:recordId}).strict().parse(raw);
  if(row.versionId!==versionId) throw domainFailure("reference_conflict","google-report.outbox-version",{versionId});
  return prepareGoogleWeeklyReport(frozen.state,row.jobId);
}
