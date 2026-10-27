import { readTutorExposureCounts } from "../../db/repositories/tutor-exposure";
import { readSessionResume } from "../../db/repositories/session-resume";
import { startContextIssues } from "./start";
import { requireCurrentTutor } from "./current";
import { readHelpDelivery } from "../../db/repositories/tutor-help";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { listTutors,requireTutorViewAccess } from "../../db/repositories/tutor";
import { readStorage,isDomainFailure } from "../../db/repositories/atomic";
import type { SiteIdentity } from "../domain/contracts";
import { tutorOverview } from "./overview";
import type { TutorOverview } from "./overview";
import { publicTutorView } from "./view";
import type { TutorView } from "./view";
import { privateJson } from "../owner-access";
import { materialErrorResponse } from "../materials/server-access";

export async function readTutorOverview(owner:SiteIdentity):Promise<TutorOverview> {
  const history=await listTutors(env.DB,owner);
  const scopes=await readStorage("tutor.scope-summaries",()=>env.DB.prepare("SELECT id,json_extract(state,'$.unit.title') AS title,json_extract(state,'$.input.date') AS date FROM study_scopes WHERE owner_id=? AND json_extract(state,'$.phase')='confirmed' ORDER BY rowid DESC LIMIT 30").bind(owner.userId).all());
  return tutorOverview.parse({history,scopes:scopes.results});
}
export async function readTutorView(owner:SiteIdentity,id:string):Promise<TutorView> { await requireTutorViewAccess(env.DB,owner,id);const resumed=await readSessionResume(env.DB,owner,id);const state=resumed.state;const base=publicTutorView(state);const corrections=resumed.reviews.filter((review)=>review.unitId===state.start.bundle.unit.unitId && review.correctionId!==null && review.recheckState==="required");const view:TutorView={...base,originalExposure:await readTutorExposureCounts(env.DB,owner,state.id,state.question.id),nextAction:base.hidden ? null : corrections.length>0 ? corrections.map((review)=>review.nextAction).join(" · ") : resumed.latest?.nextAction ?? null,startIssues:startContextIssues(resumed.latest,resumed.reviews,state.start.due)};
  try {await requireCurrentTutor(env.DB,env.BUCKET,owner,state);}catch(error:unknown){if(!isDomainFailure(error) || error.code!=="reference_conflict") throw error;return {...view,current:false,issue:state.phase==="finished" ? "이 회차 이후 공식 기록·학습 범위가 갱신됐어요. 보관된 답안과 확정 결과는 아래에서 확인할 수 있어요." : "계획·원문·정정 기록이 달라졌어요. 답안은 보존되며 AI 진단을 계속하려면 새 학습 범위를 정해야 해요.",sources:[],lesson:null,help:null,diagnosis:null};}
  return view.help ? {...view,help:{...view.help,deliveredAt:await readHelpDelivery(env.DB,owner,view.help.id)}} : view; }
export function tutorErrorResponse(error:unknown):Response {
  if(isDomainFailure(error) && ["tutor.recovery-existing-request-required","tutor.recovery-no-pending-request"].includes(error.operation)) return privateJson({error:error.code,operation:error.operation,message:"복구할 기존 AI 요청 기록을 확인하지 못했어요. 새 AI 생성이나 비용 예약은 실행하지 않았어요. 최신 수업 기록을 다시 확인해 주세요."},409);
  if(error instanceof z.ZodError) return privateJson({error:"tutor_input_invalid",message:"입력 형식과 첨부 파일을 확인해 주세요.",field:error.issues[0].path.join(".")},400);
  if(isDomainFailure(error)) return privateJson({error:error.code,operation:error.operation,message:error.code==="storage_failure" || error.code==="result_unknown" ? "저장 결과를 확인하지 못했어요. 입력을 보관한 채 최신 기록을 확인하고 같은 요청을 재시도해 주세요." : "기록 버전·원문·답안 조건이 바뀌었어요. 입력을 보관한 채 최신 기록을 확인해 주세요."},["storage_failure","result_unknown"].includes(error.code)?503:409);
  if(error instanceof Error && "code" in error && error.code==="ai_semantic_invalid") return privateJson({error:error.code,message:"AI 응답이 원문·현재 질문·도움 단계의 검증을 통과하지 못했어요. 답안과 사용량 기록은 보존되며 이 결과로 학습 상태를 진행하지 않아요."},422);
  if(error instanceof Error && "code" in error && typeof error.code==="string" && error.code.startsWith("ai_")) return privateJson({error:error.code,message:"AI 호출 조건이나 비용 한도를 확인해 주세요. 답안 작성·저장과 기존 기록 열람은 계속할 수 있어요."},503);
  return materialErrorResponse(error);
}
