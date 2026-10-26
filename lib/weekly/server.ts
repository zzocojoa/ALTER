import { env } from "cloudflare:workers";
import { z } from "zod";
import { readWeeklyWorkspace,requireCurrentWeekly } from "../../db/repositories/weekly-workspace";
import { listConfirmedUnits } from "../../db/repositories/librarian-links";
import { isDomainFailure,readStorage } from "../../db/repositories/atomic";
import { requireMaterialVisibility } from "../../db/repositories/material-access";
import { readAiRequestStatus } from "../../db/repositories/ai-status";
import { weeklyRecoveryDecision } from "./recovery";
import { domainFailure,seoulStudyDate } from "../domain/contracts";
import type { SiteIdentity } from "../domain/contracts";
import { privateJson } from "../owner-access";
import { materialErrorResponse } from "../materials/server-access";
import { requireAiConfiguration } from "../ai/configuration";
import type { AiConfiguration } from "../ai/configuration";
import { ownerAiRuntime,waitForRetry } from "../ai/server";
import { requireAiSupport } from "../ai/support";
import { prepareAiRequest } from "../ai/request-bound";
import type { AiRunRuntime } from "../ai/run";
import { weeklyAiContext,weeklyAiRequest } from "./ai";
import { weeklyVersionSummary } from "./view";
import type { WeeklyView } from "./view";
import type { WeeklyWorkspace } from "./workspace";

export type WeeklyOverview=Readonly<{today:string;courses:readonly Readonly<{id:string;title:string}>[];history:readonly Readonly<{id:string;courseId:string;start:string;end:string;version:number}>[]}>;

export async function readWeeklyOverview(owner:SiteIdentity):Promise<WeeklyOverview> {
  await requireMaterialVisibility(env.DB,owner);const units=await listConfirmedUnits(env.DB,owner);const ids=[...new Set(units.map(unit=>unit.courseId))];
  const rows=await readStorage("weekly.overview",()=>env.DB.batch([env.DB.prepare("SELECT id,title FROM courses WHERE owner_id=? ORDER BY id").bind(owner.userId),env.DB.prepare("SELECT id,course_id AS courseId,period_start AS start,period_end AS end,version FROM weekly_summaries WHERE owner_id=? ORDER BY period_start DESC,id DESC LIMIT 101").bind(owner.userId)]));
  if(rows.some(row=>!row.success)) throw domainFailure("storage_failure","weekly.overview-read",null);if(rows[1].results.length>100) throw domainFailure("limit_exceeded","weekly.history-page-limit",null);
  return {today:seoulStudyDate(Date.now()),courses:z.array(z.object({id:z.string(),title:z.string()})).parse(rows[0].results).filter(course=>ids.includes(course.id as typeof ids[number])),history:z.array(z.object({id:z.string(),courseId:z.string(),start:z.string(),end:z.string(),version:z.number()})).parse(rows[1].results)};
}
export async function readWeeklyView(owner:SiteIdentity,id:string):Promise<WeeklyView> {
  const state=await readWeeklyWorkspace(env.DB,owner,id);
  const rows=await readStorage("weekly.version-history",()=>env.DB.prepare("SELECT v.id,v.ordinal,s.confirmed_at AS confirmedAt,j.state AS exportState FROM weekly_versions v JOIN weekly_snapshots s ON s.owner_id=v.owner_id AND s.id=v.id JOIN external_jobs j ON j.owner_id=s.owner_id AND j.id=s.export_job_id WHERE v.owner_id=? AND v.summary_id=? ORDER BY v.ordinal DESC LIMIT 101").bind(owner.userId,id).all());
  if(rows.results.length>100) throw domainFailure("limit_exceeded","weekly.version-history-limit",null);const versions=z.array(weeklyVersionSummary).parse(rows.results);
  const statuses=state.pendingKey ? await readAiRequestStatus(env.DB,owner,state.pendingKey) : [];
  try{await requireCurrentWeekly(env.DB,env.BUCKET,owner,state);return {state,current:true,issue:null,versions,generationRecovery:weeklyRecoveryDecision(state,true,statuses)};}
  catch(error:unknown){if(!isDomainFailure(error) || !["reference_conflict","version_conflict"].includes(error.code)) throw error;return {state,current:false,versions,issue:"학습 기록·도움 이력·정정 또는 원문이 바뀌었어요. 현재 초안으로 확정할 수 없어요. 근거를 새로 읽고 다시 검토해 주세요.",generationRecovery:weeklyRecoveryDecision(state,false,statuses)};}
}
export function weeklyConfiguration():AiConfiguration{return requireAiConfiguration(env.ALTER_AI_CONFIGURATION);}
export async function weeklyRuntime(configuration:AiConfiguration,state:WeeklyWorkspace):Promise<AiRunRuntime> {
  const prepared=await prepareAiRequest(weeklyAiRequest(state.context));
  const current=async(owner:SiteIdentity):Promise<WeeklyWorkspace>=>{const latest=await readWeeklyWorkspace(env.DB,owner,state.id);if(latest.version!==state.version || latest.pendingKey!==state.pendingKey) throw domainFailure("version_conflict","weekly.ai-input-changed",{id:state.id});await requireCurrentWeekly(env.DB,env.BUCKET,owner,latest);return latest;};
  return {...ownerAiRuntime(configuration),wait:waitForRetry,warn:warning=>console.warn(warning),authorizeSources:async(owner,request)=>{if(request.requestFingerprint!==prepared.requestFingerprint || request.imageCount!==0) throw domainFailure("reference_conflict","weekly.ai-request-changed",null);await current(owner);},loadContext:async owner=>weeklyAiContext((await current(owner)).context),requireSupport:async(owner,_request,now)=>{if(owner.userId!==configuration.funding.ownerId) throw domainFailure("reference_conflict","weekly.funding-owner",null);requireAiSupport(configuration.support,["text","structured-output","usage","output-limit"],configuration.funding.accountFingerprint,now);}};
}
export function weeklyErrorResponse(error:unknown):Response {
  if(error instanceof z.ZodError) return privateJson({error:"weekly_input_invalid",message:"입력 형식이나 근거를 확인해 주세요.",issues:error.issues.map(issue=>({path:issue.path,message:issue.message}))},400);
  if(isDomainFailure(error)) return privateJson({error:error.code,operation:error.operation,message:error.operation==="weekly.hidden-recall-active" || error.operation.includes("hidden") ? "자료를 가린 인출을 마친 뒤 주간 기록을 확인해 주세요." : error.code==="result_unknown" ? "AI 실행 결과가 미확정이에요. 새로 생성하지 말고 기존 요청 확인을 사용해 주세요." : error.code==="limit_exceeded" ? "시간·자료 또는 비용 한도를 확인해 주세요." : "저장 버전이나 현재 근거가 달라요. 최신 기록을 읽고 수정 내용을 다시 확인해 주세요."},["storage_failure","result_unknown"].includes(error.code) ? 503 : 409);
  if(error instanceof Error && "code" in error && typeof error.code==="string" && error.code.startsWith("ai_")) return privateJson({error:error.code,message:"AI 가격·잔액·지원 또는 승인 범위를 확인해 주세요. 일반 개인 자료의 호출은 승인된 시험 검증에 포함되지 않아요."},503);
  return materialErrorResponse(error);
}
