import { contentHash,domainFailure } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { ADVISOR_ACCEPTANCE_ID,requireAdvisorAcceptance } from "../advisor/acceptance.ts";
import { getAdvisor } from "../../db/repositories/advisor.ts";
import { requireTutorAcceptance,TUTOR_ACCEPTANCE_IDS } from "../tutor/acceptance.ts";
import { requireEditorAcceptance } from "../editor/acceptance.ts";
import { EDITOR_ACCEPTANCE_IDS } from "../editor/acceptance-fixture.ts";
import { requireReviewAcceptance,REVIEW_ACCEPTANCE_ID } from "../reviews/acceptance.ts";
import { STUDY_ACCEPTANCE_TEXT } from "../librarian/acceptance-fixture.ts";
import { requireCurrentWeekly } from "../../db/repositories/weekly-workspace.ts";
import { weeklyAiRequest } from "./ai.ts";
import type { WeeklyWorkspace } from "./workspace.ts";
import type { WeeklyDispatcher } from "./processing.ts";
import { requireDispatchPricing } from "../ai/pricing.ts";
import { prepareAiRequest } from "../ai/request-bound.ts";
import { runAiAttemptSequence } from "../ai/run.ts";
import { executeAiAttempt } from "../ai/attempt.ts";
export const WEEKLY_ACCEPTANCE_ID="00000000-0000-4000-a000-000000001310";
/** 실제 개인 학습 자료가 섞이면 기존 승인 범위로 호출하지 않습니다. */
export async function requireWeeklyAcceptance(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,state:WeeklyWorkspace):Promise<void> {
  if(state.id!==WEEKLY_ACCEPTANCE_ID || state.context.availableMinutes!==60 || state.context.aggregate.corrections.length>0 || state.context.units.some(unit=>unit.planId!==ADVISOR_ACCEPTANCE_ID) || state.context.sources.length!==1 || state.context.sources[0].evidence!==STUDY_ACCEPTANCE_TEXT) throw domainFailure("reference_conflict","weekly.acceptance-fixed-context",null);
  await requireAdvisorAcceptance(await getAdvisor(db,owner,ADVISOR_ACCEPTANCE_ID));const current=await requireCurrentWeekly(db,bucket,owner,state);
  if(current.snapshot.sessions.length===0) throw domainFailure("reference_conflict","weekly.acceptance-confirmed-records-required",null);
  for(const session of current.snapshot.sessions) {
    if(TUTOR_ACCEPTANCE_IDS.some(id=>id===session.state.id)) requireTutorAcceptance(session.state);
    else if(EDITOR_ACCEPTANCE_IDS.some(id=>id===session.state.id)) requireEditorAcceptance(session.state);
    else if(session.state.id===REVIEW_ACCEPTANCE_ID) requireReviewAcceptance(session.state);
    else throw domainFailure("reference_conflict","weekly.acceptance-unapproved-session",{sessionId:session.state.id});
  }
}
export function weeklyAcceptanceDispatcher(state:WeeklyWorkspace,bucket:R2Bucket):WeeklyDispatcher {
  return async(runtime,input,signal)=>{const owner=await runtime.authenticate();await requireWeeklyAcceptance(runtime.db,bucket,owner,state);
    if(!state.pendingKey || input.logicalRequestKey!==state.pendingKey || input.pricing.purpose!=="prepaid-probe" || await contentHash(input.request)!==await contentHash(weeklyAiRequest(state.context))) throw domainFailure("reference_conflict","weekly.acceptance-request",null);
    requireDispatchPricing(input.pricing,runtime.now());await runtime.requireSupport(owner,await prepareAiRequest(input.request),runtime.now());return runAiAttemptSequence(runtime,input,executeAiAttempt,signal);
  };
}
