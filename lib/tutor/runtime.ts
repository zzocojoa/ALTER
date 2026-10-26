import { env } from "cloudflare:workers";
import jpeg from "../materials/jpeg-wasm/decoder.wasm";
import { getTutor } from "../../db/repositories/tutor";
import { requireAiConfiguration } from "../ai/configuration";
import type { AiConfiguration } from "../ai/configuration";
import { ownerAiRuntime,waitForRetry } from "../ai/server";
import { prepareAiRequest } from "../ai/request-bound";
import type { ModelRequest,InputImage } from "../ai/request-bound";
import type { AiRunRuntime } from "../ai/run";
import { requireAiSupport } from "../ai/support";
import { domainFailure } from "../domain/contracts";
import type { SiteIdentity } from "../domain/contracts";
import { tutorContext } from "./ai";
import { readTutorAnswerImages } from "./images";
import { requireCurrentTutor } from "./current";
import type { TutorState } from "./contracts";
import { getRegisteredMaterial } from "../materials/download";
import { headMaterialObject } from "../materials/object";

export function tutorConfiguration():AiConfiguration {return requireAiConfiguration(env.ALTER_AI_CONFIGURATION);}
export async function createTutorRuntime(config:AiConfiguration,owner:SiteIdentity,state:TutorState,buildRequest:(state:TutorState,images:readonly InputImage[])=>ModelRequest,signal:AbortSignal):Promise<Readonly<{runtime:AiRunRuntime;request:ModelRequest}>> {
  await requireCurrentTutor(env.DB,env.BUCKET,owner,state);
  const request=buildRequest(state,await readTutorAnswerImages(env.DB,env.BUCKET,owner,state,jpeg,signal));const prepared=await prepareAiRequest(request);
  const runtime:AiRunRuntime={...ownerAiRuntime(config),wait:waitForRetry,warn:(warning):void=>console.warn(warning),
    authorizeSources:async (identity,actual):Promise<void>=>{
      const current=await getTutor(env.DB,identity,state.id);
      if(current.version!==state.version || actual.requestFingerprint!==prepared.requestFingerprint) throw domainFailure("version_conflict","tutor.ai-input-changed",null);
      await requireCurrentTutor(env.DB,env.BUCKET,identity,current);
      for(const image of request.messages.flatMap((message)=>message.content).filter((part)=>part.type==="input_image")) await headMaterialObject(env.BUCKET,await getRegisteredMaterial(env.DB,identity,image.sourceRefId));
    },
    loadContext:async (identity)=>{
      const current=await getTutor(env.DB,identity,state.id);
      if(current.version!==state.version || current.pending?.key!==state.pending?.key) throw domainFailure("version_conflict","tutor.ai-context-changed",null);
      await requireCurrentTutor(env.DB,env.BUCKET,identity,current);return tutorContext(current);
    },
    requireSupport:async (identity,actual,now):Promise<void>=>{
      if(identity.userId!==config.funding.ownerId) throw domainFailure("reference_conflict","tutor.funding-owner",null);
      requireAiSupport(config.support,actual.imageCount>0 ? ["text","image","structured-output","usage","output-limit"] : ["text","structured-output","usage","output-limit"],config.funding.accountFingerprint,now);
    },
  };
  return {runtime,request};
}
