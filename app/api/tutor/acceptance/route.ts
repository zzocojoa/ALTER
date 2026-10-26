import { env } from "cloudflare:workers";
import { z } from "zod";
import { materialMutationAccess,materialOwnerAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { readStorage } from "@/db/repositories/atomic";
import { createTutor,getTutor } from "@/db/repositories/tutor";
import { dispatchTutorAction,submitStoredTutorAnswer } from "@/db/repositories/tutor-actions";
import { readTutorView,tutorErrorResponse } from "@/lib/tutor/server";
import { TUTOR_ACCEPTANCE_ID,TUTOR_ACCEPTANCE_IDS,TUTOR_ACCEPTANCE_QUESTION,TUTOR_ACCEPTANCE_ATTEMPT,requireTutorAcceptance,tutorAcceptanceAnswers,tutorAcceptanceDispatcher,tutorAcceptanceRequest } from "@/lib/tutor/acceptance";
import { TUTOR_HELP_ACCEPTANCE_ID } from "@/lib/tutor/acceptance-fixture";
import { LIBRARIAN_ACCEPTANCE_ID,LIBRARIAN_HELP_ACCEPTANCE_ID } from "@/lib/librarian/acceptance-fixture";
import { advisorRecordId } from "@/db/repositories/advisor";
import { beginStoredTutorAi,processTutorAi } from "@/lib/tutor/ai";
import { createTutorRuntime,tutorConfiguration } from "@/lib/tutor/runtime";
import { domainFailure,version } from "@/lib/domain/contracts";
const actions=z.enum(["prepare","lesson","direct","recall","unsure","diagnose","help","explanation","variation","answer-new","finish","recover"]);
export async function GET(request:Request):Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try {const id=z.enum(TUTOR_ACCEPTANCE_IDS).parse(new URL(request.url).searchParams.get("id"));const found=await readStorage("tutor.acceptance-existing",()=>env.DB.prepare("SELECT COUNT(*) AS n FROM tutor_sessions WHERE owner_id=? AND id=?").bind(access.owner.userId,id).first<number>("n"));return privateJson({view:found===1 ? await readTutorView(access.owner,id) : null},200);}catch(error:unknown){return tutorErrorResponse(error);}
}
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {
    const input=z.object({id:z.enum(TUTOR_ACCEPTANCE_IDS),action:actions,expectedVersion:version}).strict().parse(await readBoundedJson(request,2048));const cmd={owner:access.owner,requestKey:await advisorRecordId(`tutor-acceptance:${input.id}:${input.action}:${input.expectedVersion}`),expectedVersion:input.expectedVersion};
    if(input.action==="prepare") await createTutor(env.DB,env.BUCKET,cmd,{id:input.id,scopeId:input.id===TUTOR_HELP_ACCEPTANCE_ID ? LIBRARIAN_HELP_ACCEPTANCE_ID : LIBRARIAN_ACCEPTANCE_ID,questionId:input.id===TUTOR_ACCEPTANCE_ID ? TUTOR_ACCEPTANCE_QUESTION : await advisorRecordId(`${input.id}:question`),attemptId:input.id===TUTOR_ACCEPTANCE_ID ? TUTOR_ACCEPTANCE_ATTEMPT : await advisorRecordId(`${input.id}:attempt`)},Date.now());
    else {
      let state=await getTutor(env.DB,access.owner,input.id);requireTutorAcceptance(state);if(state.version!==input.expectedVersion) throw domainFailure("version_conflict","tutor.acceptance-version",null);
      if(input.action==="unsure" || input.action==="explanation" || input.action==="answer-new") {const text=input.action==="unsure" ? tutorAcceptanceAnswers.unsure : input.action==="explanation" ? tutorAcceptanceAnswers.explanation : tutorAcceptanceAnswers.variation;await submitStoredTutorAnswer(env.DB,env.BUCKET,cmd,state.id,await advisorRecordId(`tutor-acceptance-answer:${input.id}:${input.action}:${state.version}`),{text,fileIds:[]},Date.now());}
      else if(input.action==="recall" || input.action==="direct" || input.action==="finish") await dispatchTutorAction(env.DB,env.BUCKET,cmd,{action:input.action,id:state.id,expectedVersion:state.version},Date.now());
      else {if(input.action!=="recover") await beginStoredTutorAi(env.DB,env.BUCKET,cmd,state.id,input.action);state=await getTutor(env.DB,access.owner,state.id);if(state.pending){const config=tutorConfiguration();const {runtime,request:aiRequest}=await createTutorRuntime(config,access.owner,state,tutorAcceptanceRequest,request.signal);await processTutorAi(runtime,env.BUCKET,access.owner,state.id,config.pricing,aiRequest,tutorAcceptanceDispatcher(state),request.signal);}}
    }
    return privateJson({view:await readTutorView(access.owner,input.id)},200);
  }catch(error:unknown){return tutorErrorResponse(error);}
}
