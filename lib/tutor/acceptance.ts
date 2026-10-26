import { TUTOR_ACCEPTANCE_IDS,TUTOR_HELP_ACCEPTANCE_ID } from "./acceptance-fixture.ts";
export { TUTOR_ACCEPTANCE_ID,TUTOR_ACCEPTANCE_IDS,TUTOR_ACCEPTANCE_QUESTION,TUTOR_ACCEPTANCE_ATTEMPT } from "./acceptance-fixture.ts";
import { contentHash,domainFailure } from "../domain/contracts.ts";
import { ADVISOR_ACCEPTANCE_ID } from "../advisor/acceptance.ts";
import { LIBRARIAN_ACCEPTANCE_ID,LIBRARIAN_HELP_ACCEPTANCE_ID,STUDY_ACCEPTANCE_TEXT } from "../librarian/acceptance-fixture.ts";
import type { TutorState } from "./contracts.ts";
import { tutorRequest } from "./ai.ts";
import type { TutorDispatcher } from "./ai.ts";
import type { ModelRequest,InputImage } from "../ai/request-bound.ts";
import { prepareAiRequest } from "../ai/request-bound.ts";
import { executeAiAttempt } from "../ai/attempt.ts";
import { runAiAttemptSequence } from "../ai/run.ts";
import { requireDispatchPricing } from "../ai/pricing.ts";
export const tutorAcceptanceAnswers={unsure:"분수의 분자와 분모가 어떤 뜻인지 아직 모르겠습니다.",explanation:"분수는 전체를 같은 크기로 나눈 부분을 나타냅니다. 분모는 전체를 나눈 같은 크기 조각의 수이고, 분자는 선택한 조각의 수입니다. 1/4은 전체를 같은 크기의 네 조각으로 나눈 것 중 한 조각입니다. 같은 분모 덧셈은 조각 크기가 같아서 분자만 더합니다.",variation:"전체를 같은 크기의 다섯 조각으로 나누고 두 조각을 선택했으므로 2/5입니다. 분모 5는 같은 크기로 나눈 전체 조각 수이고 분자 2는 선택한 조각 수입니다."} as const;
export function requireTutorAcceptance(state:TutorState):void {
  if(!TUTOR_ACCEPTANCE_IDS.some((id):boolean=>id===state.id) || state.start.scopeId!==(state.id===TUTOR_HELP_ACCEPTANCE_ID ? LIBRARIAN_HELP_ACCEPTANCE_ID : LIBRARIAN_ACCEPTANCE_ID) || state.start.bundle.unit.planId!==ADVISOR_ACCEPTANCE_ID || state.start.bundle.sources.length!==1 || state.start.bundle.sources[0].evidence!==STUDY_ACCEPTANCE_TEXT || state.answers.some((answer):boolean=>answer.fileIds.length!==0 || !Object.values(tutorAcceptanceAnswers).some((text):boolean=>text===answer.text))) throw domainFailure("reference_conflict","tutor.acceptance-fixed-input",null);
}
export function tutorAcceptanceRequest(state:TutorState,images:readonly InputImage[]):ModelRequest {
  requireTutorAcceptance(state);if(images.length!==0) throw domainFailure("reference_conflict","tutor.acceptance-no-private-images",null);
  const request=tutorRequest(state,images);
  return state.pending?.kind==="tutor-variation" ? {...request,instructions:request.instructions+" 이번 고정 검증의 새 조건은 전체를 같은 크기의 다섯 조각으로 나누고 두 조각을 선택한 상황입니다. 분수와 분자·분모 의미를 묻는 과제 하나로 제시하세요. 정답은 제시하지 마세요."} : request;
}
export function tutorAcceptanceDispatcher(state:TutorState):TutorDispatcher {
  return async (runtime,input,signal)=>{
    requireTutorAcceptance(state);
    if(!state.pending || input.logicalRequestKey!==state.pending.key || input.pricing.purpose!=="prepaid-probe" || await contentHash(input.request)!==await contentHash(tutorAcceptanceRequest(state,[]))) throw domainFailure("reference_conflict","tutor.acceptance-request",null);
    requireDispatchPricing(input.pricing,runtime.now());const owner=await runtime.authenticate();await runtime.requireSupport(owner,await prepareAiRequest(input.request),runtime.now());return runAiAttemptSequence(runtime,input,executeAiAttempt,signal);
  };
}
