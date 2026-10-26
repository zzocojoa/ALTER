import { confirmWeeklyWorkspace,readWeeklyFrozen } from "@/db/repositories/weekly-confirmation";
import { env } from "cloudflare:workers";
import { materialMutationAccess,materialOwnerAccess } from "@/lib/materials/server-access";
import { materialRequestKey,readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { domainFailure } from "@/lib/domain/contracts";
import { weeklyAction } from "@/lib/weekly/request";
import { resetWeeklyGeneration } from "@/db/repositories/weekly-generation";
import { readWeeklyOverview,readWeeklyView,weeklyConfiguration,weeklyRuntime,weeklyErrorResponse } from "@/lib/weekly/server";
import { processWeeklyAi,dispatchWeekly } from "@/lib/weekly/processing";
import { beginWeeklyAi,createWeeklyWorkspace,readWeeklyWorkspace,refreshWeeklyEvidence,saveWeeklyWorkspace,setWeeklyTime } from "@/db/repositories/weekly-workspace";

export async function GET(request:Request):Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try{const params=new URL(request.url).searchParams;const frozenId=params.get("version");if(frozenId) return privateJson(await readWeeklyFrozen(env.DB,env.BUCKET,access.owner,frozenId),200);const id=params.get("id");return privateJson(id ? await readWeeklyView(access.owner,id) : await readWeeklyOverview(access.owner),200);}catch(error:unknown){return weeklyErrorResponse(error);}
}
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {
    const input=weeklyAction.parse(await readBoundedJson(request,65536));const cmd={owner:access.owner,expectedVersion:"expectedVersion" in input ? input.expectedVersion : 1,requestKey:materialRequestKey(request.headers)};
    if(input.action==="start"){await createWeeklyWorkspace(env.DB,env.BUCKET,cmd,input.input);return privateJson(await readWeeklyView(access.owner,input.input.id),200);}
    if(input.action==="confirm" || input.action==="confirm-local") await confirmWeeklyWorkspace(env.DB,env.BUCKET,cmd,{id:input.id,expectedVersion:input.expectedVersion,businessKey:input.businessKey,fingerprint:input.fingerprint},Date.now());
    if(input.action==="save") await saveWeeklyWorkspace(env.DB,env.BUCKET,cmd,input.id,input.input);
    if(input.action==="time") await setWeeklyTime(env.DB,env.BUCKET,cmd,input.id,input.availableMinutes);
    if(input.action==="refresh") await refreshWeeklyEvidence(env.DB,env.BUCKET,cmd,input.id);
    if(input.action==="reset-generation") await resetWeeklyGeneration(env.DB,env.BUCKET,cmd,input.id);
    if(input.action==="generate" || input.action==="recover") {
      if(input.action==="generate") await beginWeeklyAi(env.DB,env.BUCKET,cmd,input.id);const state=await readWeeklyWorkspace(env.DB,access.owner,input.id);
      if(input.action==="recover" && !state.pendingKey && state.version!==input.expectedVersion) throw domainFailure("version_conflict","weekly.recovery-version",null);
      if(state.pendingKey){const config=weeklyConfiguration();await processWeeklyAi(await weeklyRuntime(config,state),env.BUCKET,access.owner,input.id,config.pricing,dispatchWeekly,request.signal);}
    }
    return privateJson(await readWeeklyView(access.owner,input.id),200);
  }catch(error:unknown){return weeklyErrorResponse(error);}
}
