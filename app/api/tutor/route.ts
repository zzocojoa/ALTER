import { scheduledReviewProbeDispatcher } from "@/lib/reviews/scheduled-acceptance";
import { approvedTutorDispatcher } from "@/lib/tutor/handwriting-acceptance";
import { beginStoredTutorAi,processTutorAi,tutorRequest } from "@/lib/tutor/ai";
import { createTutorRuntime,tutorConfiguration } from "@/lib/tutor/runtime";
import { getTutor } from "@/db/repositories/tutor";
import { domainFailure } from "@/lib/domain/contracts";
import { env } from "cloudflare:workers";
import { materialMutationAccess,materialOwnerAccess } from "@/lib/materials/server-access";
import { materialRequestKey,readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { tutorAction } from "@/lib/tutor/request";
import { readTutorOverview,readTutorView,tutorErrorResponse } from "@/lib/tutor/server";
import { dispatchTutorAction } from "@/db/repositories/tutor-actions";

export async function GET(request:Request):Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try {const id=new URL(request.url).searchParams.get("id");return privateJson(id ? await readTutorView(access.owner,id) : await readTutorOverview(access.owner),200);}catch(error:unknown){return tutorErrorResponse(error);}
}
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {
    const input=tutorAction.parse(await readBoundedJson(request,262144));
    const cmd={owner:access.owner,requestKey:materialRequestKey(request.headers),expectedVersion:"expectedVersion" in input ? input.expectedVersion : 1};
    if(input.action!=="start") {const current=await getTutor(env.DB,access.owner,input.id);if(current.editor && current.editor.phase!=="variation") throw domainFailure("reference_conflict","editor.use-revision-flow",null);}
    if(input.action==="lesson" || input.action==="diagnose" || input.action==="help" || input.action==="variation" || input.action==="recover") {
      if(input.action!=="recover") await beginStoredTutorAi(env.DB,env.BUCKET,cmd,input.id,input.action);
      const state=await getTutor(env.DB,access.owner,input.id);
      if(input.action==="recover" && state.version!==input.expectedVersion) throw domainFailure("version_conflict","tutor.recover-version",null);
      if(state.pending) {const config=tutorConfiguration();const {runtime,request:aiRequest}=await createTutorRuntime(config,access.owner,state,tutorRequest,request.signal);await processTutorAi(runtime,env.BUCKET,access.owner,state.id,config.pricing,aiRequest,config.scheduledReviewProbeApproval?.sessionId===state.id ? scheduledReviewProbeDispatcher(state,config.scheduledReviewProbeApproval) : approvedTutorDispatcher(state,config.handwritingProbeApproval),request.signal);}
    } else await dispatchTutorAction(env.DB,env.BUCKET,cmd,input,Date.now());
    return privateJson(await readTutorView(access.owner,input.id),200);
  }catch(error:unknown){return tutorErrorResponse(error);}
}
