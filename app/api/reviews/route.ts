import { readStorage } from "@/db/repositories/atomic";
import { env } from "cloudflare:workers";
import { reviewAction } from "@/lib/reviews/request";
import { instant,seoulCalendarDate } from "@/lib/reviews/calendar";
import { recordId } from "@/lib/domain/contracts";
import { materialOwnerAccess,materialMutationAccess } from "@/lib/materials/server-access";
import { materialRequestKey,readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { tutorErrorResponse } from "@/lib/tutor/server";
import { readReviewOverview,requireReviewVisibility } from "@/db/repositories/review-overview";
import { chooseReviewSchedule,prepareExistingReview,readReviewPlan } from "@/db/repositories/review-policy";
import { startReviewSession } from "@/db/repositories/review-session";
import { applyCorrection } from "@/db/repositories/reviews";

export async function GET():Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try{return privateJson(await readReviewOverview(env.DB,access.owner,instant.parse(new Date().toISOString()),"Asia/Seoul"),200);}catch(error:unknown){return tutorErrorResponse(error);}
}
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {
    const input=reviewAction.parse(await readBoundedJson(request,65536));const now=Date.now();const date=instant.parse(new Date(now).toISOString());const cmd={owner:access.owner,requestKey:materialRequestKey(request.headers),expectedVersion:input.expectedVersion};
    if(input.action==="start"){await startReviewSession(env.DB,env.BUCKET,cmd,input,now);return privateJson({href:`/learn/tutor?id=${input.id}`},200);}
    await requireReviewVisibility(env.DB,access.owner);
    if(input.action==="prepare") await prepareExistingReview(env.DB,cmd,input.id,now);
    if(input.action==="choose") await chooseReviewSchedule(env.DB,cmd,input,now);
    if(input.action==="correct") {
      const plan=await readReviewPlan(env.DB,access.owner,input.id,date);const recordedAt=await readStorage("review.correction-retry",()=>env.DB.prepare("SELECT created_at FROM corrections WHERE owner_id=? AND id=?").bind(access.owner.userId,input.correctionId).first<number>("created_at"));const correctedAt=recordedAt ?? now;
      await applyCorrection(env.DB,cmd,{id:recordId.parse(input.correctionId),errorId:plan.errorId,concept:plan.evidence.concept,sourceRefId:plan.sourceRefId,answerId:plan.evidence.answerId,studyDate:seoulCalendarDate(instant.parse(new Date(correctedAt).toISOString()),"Asia/Seoul"),createdAt:correctedAt,reason:input.reason,evidence:input.evidence,targets:input.targets.map((target)=>({...target,question:input.question,explanation:input.explanation,nextAction:input.nextAction}))});
    }
    return privateJson(await readReviewOverview(env.DB,access.owner,date,"Asia/Seoul"),200);
  }catch(error:unknown){return tutorErrorResponse(error);}
}
