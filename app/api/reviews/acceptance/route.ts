import { env } from "cloudflare:workers";
import { z } from "zod";
import { materialMutationAccess,materialOwnerAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { readStorage } from "@/db/repositories/atomic";
import { advisorRecordId } from "@/db/repositories/advisor";
import { getTutor } from "@/db/repositories/tutor";
import { submitStoredTutorAnswer,dispatchTutorAction } from "@/db/repositories/tutor-actions";
import { prepareExistingReview,readReviewPlan,chooseReviewSchedule } from "@/db/repositories/review-policy";
import { startReviewSession } from "@/db/repositories/review-session";
import { beginStoredTutorAi,processTutorAi } from "@/lib/tutor/ai";
import { createTutorRuntime,tutorConfiguration } from "@/lib/tutor/runtime";
import { readTutorView,tutorErrorResponse } from "@/lib/tutor/server";
import { REVIEW_ACCEPTANCE_ID,REVIEW_ACCEPTANCE_ANSWER,requireReviewAcceptance,reviewAcceptanceRequest,reviewAcceptanceDispatcher } from "@/lib/reviews/acceptance";
import { instant } from "@/lib/reviews/calendar";
import { domainFailure,recordId,seoulStudyDate,version } from "@/lib/domain/contracts";
export async function GET():Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try{const found=await readStorage("review.acceptance-found",()=>env.DB.prepare("SELECT count(*) AS n FROM tutor_sessions WHERE owner_id=? AND id=?").bind(access.owner.userId,REVIEW_ACCEPTANCE_ID).first<number>("n"));return privateJson({view:found===1 ? await readTutorView(access.owner,REVIEW_ACCEPTANCE_ID) : null},200);}catch(error:unknown){return tutorErrorResponse(error);}
}
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {
    const input=z.object({action:z.enum(["prepare","submit","diagnose","recover","finish"]),expectedVersion:version}).strict().parse(await readBoundedJson(request,2048));const now=Date.now();const cmd={owner:access.owner,expectedVersion:input.expectedVersion,requestKey:await advisorRecordId(`review-acceptance:${input.action}:${input.expectedVersion}`)};
    if(input.action==="prepare") {
      const target=await readStorage("review.acceptance-fixed-result",()=>env.DB.prepare("SELECT t.review_id AS id,r.version FROM result_review_targets t JOIN session_confirmations c ON c.owner_id=t.owner_id AND c.result_version_id=t.result_version_id JOIN review_items r ON r.owner_id=t.owner_id AND r.id=t.review_id WHERE c.owner_id=? AND c.session_id='00000000-0000-4000-a000-000000001019' AND t.kind='self-explanation'").bind(access.owner.userId).first<{id:string;version:number}>());if(!target) throw domainFailure("reference_conflict","review.acceptance-task11-result-required",null);
      const exists=await readStorage("review.acceptance-plan",()=>env.DB.prepare("SELECT count(*) AS n FROM review_plans WHERE owner_id=? AND id=?").bind(access.owner.userId,target.id).first<number>("n"));
      if(exists===0) await prepareExistingReview(env.DB,{...cmd,expectedVersion:target.version,requestKey:"review-acceptance:proposal"},target.id,now);
      let plan=await readReviewPlan(env.DB,access.owner,target.id,instant.parse(new Date(now).toISOString()));
      if(plan.decision.status==="proposed") await chooseReviewSchedule(env.DB,{...cmd,expectedVersion:plan.version,requestKey:"review-acceptance:accept"},{id:plan.id,expectedVersion:plan.version,type:"concept",conditions:{goalDate:null,retentionDays:30,availableMinutes:30,requiredMinutes:10},dueDate:seoulStudyDate(now),reason:"승인된 Task 12 시험 분수 답안으로 오늘 독립 설명을 검증"},now);
      plan=await readReviewPlan(env.DB,access.owner,target.id,instant.parse(new Date(now).toISOString()));
      await startReviewSession(env.DB,env.BUCKET,{...cmd,expectedVersion:plan.version},{id:REVIEW_ACCEPTANCE_ID,reviewId:plan.id,expectedVersion:plan.version,questionId:await advisorRecordId("review-acceptance:question"),attemptId:await advisorRecordId("review-acceptance:attempt")},now);
    } else {
      let state=await getTutor(env.DB,access.owner,REVIEW_ACCEPTANCE_ID);requireReviewAcceptance(state);if(state.version!==input.expectedVersion) throw domainFailure("version_conflict","review.acceptance-version",null);
      if(input.action==="submit") await submitStoredTutorAnswer(env.DB,env.BUCKET,cmd,state.id,await advisorRecordId("review-acceptance:answer"),{text:REVIEW_ACCEPTANCE_ANSWER,fileIds:[]},now);
      else if(input.action==="finish") await dispatchTutorAction(env.DB,env.BUCKET,cmd,{action:"finish",id:recordId.parse(state.id),expectedVersion:state.version},now);
      else {if(input.action==="diagnose") await beginStoredTutorAi(env.DB,env.BUCKET,cmd,state.id,"diagnose");state=await getTutor(env.DB,access.owner,state.id);if(state.pending){const config=tutorConfiguration();const {runtime,request:aiRequest}=await createTutorRuntime(config,access.owner,state,reviewAcceptanceRequest,request.signal);await processTutorAi(runtime,env.BUCKET,access.owner,state.id,config.pricing,aiRequest,reviewAcceptanceDispatcher(state),request.signal);}}
    }
    return privateJson({view:await readTutorView(access.owner,REVIEW_ACCEPTANCE_ID)},200);
  }catch(error:unknown){return tutorErrorResponse(error);}
}
