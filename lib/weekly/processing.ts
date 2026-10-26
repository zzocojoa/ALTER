import { domainFailure } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { learningOutput } from "../ai/learning-contract.ts";
import type { LearningOutput } from "../ai/learning-contract.ts";
import { recoverAiResponse } from "../ai/recover.ts";
import { runAiRequest } from "../ai/run.ts";
import type { AiRunRuntime,AiRunInput,AiRunOutcome } from "../ai/run.ts";
import type { PricingVersion } from "../ai/pricing.ts";
import { readAiRequestStatus } from "../../db/repositories/ai-status.ts";
import { readWeeklyWorkspace,requireCurrentWeekly,saveWeeklyAi } from "../../db/repositories/weekly-workspace.ts";
import { weeklyGenerationGuard } from "../../db/repositories/weekly-generation.ts";
import { weeklyAiRequest } from "./ai.ts";
import type { WeeklyWorkspace } from "./workspace.ts";

/** 유료 시도가 있으면 기존 응답만 조회하며 미확정 결과를 새 생성으로 대체하지 않습니다. */
export type WeeklyDispatcher=(runtime:AiRunRuntime,input:AiRunInput,signal:AbortSignal)=>Promise<AiRunOutcome>;
export const dispatchWeekly:WeeklyDispatcher=runAiRequest;
/** 주간 상태의 유효성을 비용 예약 배치에도 고정해 초기화된 실행의 뒤늦은 전송을 막습니다. */
export function bindWeeklyGeneration(runtime:AiRunRuntime,owner:SiteIdentity,state:WeeklyWorkspace):AiRunRuntime {
  return {...runtime,reservationGuards:(current,requestId)=>{
    if(current.userId!==owner.userId) throw domainFailure("reference_conflict","weekly.generation-owner",{id:state.id});
    return [...(runtime.reservationGuards ? runtime.reservationGuards(current,requestId) : []),weeklyGenerationGuard(runtime.db,current,state,requestId)];
  }};
}
export async function processWeeklyAi(runtime:AiRunRuntime,bucket:R2Bucket,owner:SiteIdentity,id:string,pricing:PricingVersion,dispatch:WeeklyDispatcher,signal:AbortSignal):Promise<WeeklyWorkspace> {
  const state=await readWeeklyWorkspace(runtime.db,owner,id);if(!state.pendingKey) return state;await requireCurrentWeekly(runtime.db,bucket,owner,state);
  const statuses=await readAiRequestStatus(runtime.db,owner,state.pendingKey);let output:LearningOutput;
  if(statuses.length>0) {
    const previous=statuses.toReversed().find(entry=>entry.stage==="validated" || entry.responseId!==null && entry.stage!=="invalid");
    if(!previous) throw domainFailure("result_unknown","weekly.previous-attempt-needs-review",null);
    output=previous.stage==="validated" && previous.result ? learningOutput.parse(JSON.parse(previous.result)) : await recoverAiResponse(runtime,previous.callId,"weekly-review",signal);
  } else {
    const result=await dispatch(bindWeeklyGeneration(runtime,owner,state),{logicalRequestKey:state.pendingKey,request:weeklyAiRequest(state.context),pricing,expectedKind:"weekly-review"},signal);
    if(result.kind==="existing") throw domainFailure("result_unknown","weekly.in-progress-recover-only",null);output=result.output;
  }
  if(output.result.kind!=="weekly-review") throw domainFailure("reference_conflict","weekly.output-kind",null);await saveWeeklyAi(runtime.db,bucket,owner,state,output.result);return readWeeklyWorkspace(runtime.db,owner,id);
}
