import { EDITOR_ACCEPTANCE_VARIATION } from "../editor/acceptance-fixture.ts";
import { contentHash,domainFailure } from "../domain/contracts.ts";
import { ADVISOR_ACCEPTANCE_ID } from "../advisor/acceptance.ts";
import { LIBRARIAN_ACCEPTANCE_ID,STUDY_ACCEPTANCE_TEXT } from "../librarian/acceptance-fixture.ts";
import { tutorRequest } from "../tutor/ai.ts";
import type { TutorDispatcher } from "../tutor/ai.ts";
import type { TutorState } from "../tutor/contracts.ts";
import type { ModelRequest,InputImage } from "../ai/request-bound.ts";
import { prepareAiRequest } from "../ai/request-bound.ts";
import { executeAiAttempt } from "../ai/attempt.ts";
import { runAiAttemptSequence } from "../ai/run.ts";
import { requireDispatchPricing } from "../ai/pricing.ts";
export const REVIEW_ACCEPTANCE_ID="00000000-0000-4000-a000-000000001210";
export const REVIEW_ACCEPTANCE_ANSWER="새 예시: 전체를 같은 크기의 네 조각으로 나누고 한 조각 선택\n자신의 설명: 분수 1/4은 전체를 같은 크기로 나눈 네 조각 중 한 조각을 뜻합니다. 분모 4는 전체 조각 수이고 분자 1은 선택한 조각 수입니다.";
export function requireReviewAcceptance(state:TutorState):void {
  if(state.id!==REVIEW_ACCEPTANCE_ID || !state.review || state.review.task.type!=="concept" || state.review.correctionId!==null || state.review.task.originalPrompt!==EDITOR_ACCEPTANCE_VARIATION || state.review.task.criterion!==state.start.bundle.unit.selfExplanationCriterion || state.editor || state.start.scopeId!==LIBRARIAN_ACCEPTANCE_ID || state.start.bundle.unit.planId!==ADVISOR_ACCEPTANCE_ID || state.start.bundle.sources.length!==1 || state.start.bundle.sources[0].evidence!==STUDY_ACCEPTANCE_TEXT || state.answers.some((answer)=>answer.fileIds.length!==0 || answer.text!==REVIEW_ACCEPTANCE_ANSWER) || state.questions.length!==1 || state.help.length!==0) throw domainFailure("reference_conflict","review.acceptance-fixed-input",null);
}
export function reviewAcceptanceRequest(state:TutorState,images:readonly InputImage[]):ModelRequest {
  requireReviewAcceptance(state);if(images.length!==0 || state.pending?.kind!=="tutor-diagnosis") throw domainFailure("reference_conflict","review.acceptance-diagnosis-only",null);return tutorRequest(state,images);
}
export function reviewAcceptanceDispatcher(state:TutorState):TutorDispatcher {
  return async(runtime,input,signal)=>{requireReviewAcceptance(state);if(!state.pending || input.logicalRequestKey!==state.pending.key || input.pricing.purpose!=="prepaid-probe" || await contentHash(input.request)!==await contentHash(reviewAcceptanceRequest(state,[]))) throw domainFailure("reference_conflict","review.acceptance-request",null);requireDispatchPricing(input.pricing,runtime.now());const owner=await runtime.authenticate();await runtime.requireSupport(owner,await prepareAiRequest(input.request),runtime.now());return runAiAttemptSequence(runtime,input,executeAiAttempt,signal);};
}
