import { env } from "cloudflare:workers";
import { z } from "zod";
import { materialOwnerAccess,materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { readStorage } from "@/db/repositories/atomic";
import { advisorRecordId,getAdvisor } from "@/db/repositories/advisor";
import { ADVISOR_ACCEPTANCE_ID,requireAdvisorAcceptance } from "@/lib/advisor/acceptance";
import { WEEKLY_ACCEPTANCE_ID,requireWeeklyAcceptance,weeklyAcceptanceDispatcher } from "@/lib/weekly/acceptance";
import { createWeeklyWorkspace,beginWeeklyAi,readWeeklyWorkspace } from "@/db/repositories/weekly-workspace";
import { processWeeklyAi } from "@/lib/weekly/processing";
import { readWeeklyView,weeklyConfiguration,weeklyErrorResponse,weeklyRuntime } from "@/lib/weekly/server";
import { domainFailure,recordId,seoulStudyDate,version } from "@/lib/domain/contracts";
export async function GET():Promise<Response>{const access=await materialOwnerAccess();if(access.rejection) return access.rejection;try{const found=await readStorage("weekly.acceptance-found",()=>env.DB.prepare("SELECT count(*) AS n FROM weekly_summaries WHERE owner_id=? AND id=?").bind(access.owner.userId,WEEKLY_ACCEPTANCE_ID).first<number>("n"));return privateJson({view:found===1 ? await readWeeklyView(access.owner,WEEKLY_ACCEPTANCE_ID) : null},200);}catch(error:unknown){return weeklyErrorResponse(error);}}
export async function POST(request:Request):Promise<Response>{
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try{const input=z.object({action:z.enum(["prepare","generate","recover"]),expectedVersion:version}).strict().parse(await readBoundedJson(request,2048));const cmd={owner:access.owner,expectedVersion:input.expectedVersion,requestKey:await advisorRecordId(`weekly-acceptance:${input.action}:${input.expectedVersion}`)};
    if(input.action==="prepare"){const advisor=await getAdvisor(env.DB,access.owner,ADVISOR_ACCEPTANCE_ID);await requireAdvisorAcceptance(advisor);const courseId=await readStorage("weekly.acceptance-course",()=>env.DB.prepare("SELECT course_id FROM plan_versions WHERE owner_id=? AND id=?").bind(access.owner.userId,advisor.confirmedPlanVersionId).first<string>("course_id"));if(!courseId) throw domainFailure("reference_conflict","weekly.acceptance-course",null);await createWeeklyWorkspace(env.DB,env.BUCKET,cmd,{id:recordId.parse(WEEKLY_ACCEPTANCE_ID),courseId:recordId.parse(courseId),date:seoulStudyDate(Date.now()),availableMinutes:60});}
    else {let state=await readWeeklyWorkspace(env.DB,access.owner,WEEKLY_ACCEPTANCE_ID);await requireWeeklyAcceptance(env.DB,env.BUCKET,access.owner,state);if(state.version!==input.expectedVersion) throw domainFailure("version_conflict","weekly.acceptance-version",null);if(input.action==="generate") await beginWeeklyAi(env.DB,env.BUCKET,cmd,state.id);state=await readWeeklyWorkspace(env.DB,access.owner,state.id);if(state.pendingKey){const config=weeklyConfiguration();await processWeeklyAi(await weeklyRuntime(config,state),env.BUCKET,access.owner,state.id,config.pricing,weeklyAcceptanceDispatcher(state,env.BUCKET),request.signal);}}
    return privateJson({view:await readWeeklyView(access.owner,WEEKLY_ACCEPTANCE_ID)},200);
  }catch(error:unknown){return weeklyErrorResponse(error);}
}
