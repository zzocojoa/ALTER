import { z } from "zod";
import { domainFailure,recordId } from "../../lib/domain/contracts.ts";
import type { Command,SiteIdentity } from "../../lib/domain/contracts.ts";
import { weeklyWorkspace } from "../../lib/weekly/workspace.ts";
import type { WeeklyWorkspace } from "../../lib/weekly/workspace.ts";
import { weeklyConfirm,weeklyBusinessKey,weeklyExportContent } from "../../lib/weekly/confirmation.ts";
import type { WeeklyConfirm } from "../../lib/weekly/confirmation.ts";
import { readWeeklyWorkspace,requireCurrentWeekly,weeklyWorkspaceStatements } from "./weekly-workspace.ts";
import { executeAtomic,readAtomicReceipt,readStorage,isDomainFailure } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { externalJobStatements } from "./external.ts";
import { requireMaterialVisibility } from "./material-access.ts";

/** 확정 요약·불변 근거·내보내기 요청은 같은 배치로 저장하며 추가 승인을 만들지 않습니다. */
export async function confirmWeeklyWorkspace(db:D1Database,bucket:R2Bucket,cmd:Command,value:WeeklyConfirm,now:number):Promise<Receipt> {
  const input=weeklyConfirm.parse(value);const replay=await readAtomicReceipt(db,cmd,"weekly.workspace-confirm",input,input.id);if(replay) return replay;
  const state=await readWeeklyWorkspace(db,cmd.owner,input.id);
  if(state.phase!=="proposed" || state.version!==input.expectedVersion || cmd.expectedVersion!==input.expectedVersion || input.fingerprint!==state.fingerprint || input.businessKey!==weeklyBusinessKey(state)) throw domainFailure("version_conflict","weekly.confirm-latest-draft",{id:input.id});
  const current=await requireCurrentWeekly(db,bucket,cmd.owner,state);const content=weeklyExportContent(state);const versionId=recordId.parse(crypto.randomUUID());const jobId=recordId.parse(crypto.randomUUID());
  const next=weeklyWorkspace.parse({...state,version:state.version+1,phase:"confirmed",confirmedVersionId:versionId,pendingKey:null});
  const resultIds=[...new Set(state.claims.map(claim=>claim.resultVersionId))];
  return executeAtomic(db,cmd,"weekly.workspace-confirm",input,state.id,next.version,requestId=>[
    ...weeklyWorkspaceStatements(db,cmd,state,next,current,requestId),
    db.prepare("INSERT INTO weekly_versions VALUES (?,?,?,?,?,?,?,?,?,?)").bind(cmd.owner.userId,versionId,state.id,next.version,state.context.units[0].planVersionId,content.achievements,content.difficulties,content.improvements,content.nextActions,now),
    ...resultIds.map(resultId=>db.prepare("INSERT INTO weekly_evidence VALUES (?,?,?,?,(SELECT correction_id FROM confirmed_results WHERE owner_id=? AND id=?))").bind(cmd.owner.userId,crypto.randomUUID(),versionId,resultId,cmd.owner.userId,resultId)),
    ...externalJobStatements(db,cmd,{id:jobId,weeklyVersionId:versionId,businessKey:`weekly-export:${versionId}`,kind:"weekly-export",steps:[{id:recordId.parse(crypto.randomUUID()),kind:"google-docs-weekly-report"},{id:recordId.parse(crypto.randomUUID()),kind:"google-sheets-weekly-row"}]},requestId),
    db.prepare("INSERT INTO weekly_snapshots VALUES (?,?,?,?,?,?)").bind(cmd.owner.userId,versionId,JSON.stringify(next),state.fingerprint,jobId,now),
  ]);
}
export type WeeklyFrozen=Readonly<{state:WeeklyWorkspace;confirmedAt:number;exportState:string;current:boolean;issue:string|null}>;
export async function readWeeklyFrozen(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,id:string):Promise<WeeklyFrozen> {
  recordId.parse(id);await requireMaterialVisibility(db,owner);const raw=await readStorage("weekly.frozen-read",()=>db.prepare("SELECT s.content,s.confirmed_at AS confirmedAt,j.state AS exportState FROM weekly_snapshots s JOIN external_jobs j ON j.owner_id=s.owner_id AND j.id=s.export_job_id WHERE s.owner_id=? AND s.id=?").bind(owner.userId,id).first());
  if(!raw) throw domainFailure("reference_conflict","weekly.frozen-owner",{id});const row=z.object({content:z.string(),confirmedAt:z.number(),exportState:z.string()}).parse(raw);const state=weeklyWorkspace.parse(JSON.parse(row.content));
  let current=true;
  try{await requireCurrentWeekly(db,bucket,owner,state);}catch(error:unknown){if(!isDomainFailure(error) || !["reference_conflict","version_conflict"].includes(error.code)) throw error;current=false;}
  return {state,confirmedAt:row.confirmedAt,exportState:row.exportState,current,issue:current ? null : "현재 근거가 달라 재검증이 필요한 이전 확정본이에요."};
}
