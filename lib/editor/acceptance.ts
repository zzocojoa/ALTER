import { contentHash,domainFailure } from "../domain/contracts.ts";
import { ADVISOR_ACCEPTANCE_ID } from "../advisor/acceptance.ts";
import { LIBRARIAN_ACCEPTANCE_ID,STUDY_ACCEPTANCE_TEXT } from "../librarian/acceptance-fixture.ts";
import type { TutorState } from "../tutor/contracts.ts";
import { tutorRequest } from "../tutor/ai.ts";
import type { TutorDispatcher } from "../tutor/ai.ts";
import type { ModelRequest,InputImage } from "../ai/request-bound.ts";
import { prepareAiRequest } from "../ai/request-bound.ts";
import { executeAiAttempt } from "../ai/attempt.ts";
import { runAiAttemptSequence } from "../ai/run.ts";
import { requireDispatchPricing } from "../ai/pricing.ts";
import { editorRequest } from "./request.ts";
import { EDITOR_ACCEPTANCE_IDS,EDITOR_ACCEPTANCE_TASK,EDITOR_ACCEPTANCE_VARIATION,editorAcceptanceAnswers } from "./acceptance-fixture.ts";
export function requireEditorAcceptance(state:TutorState):void {
  const texts=[editorAcceptanceAnswers.draft,editorAcceptanceAnswers.revision,editorAcceptanceAnswers.variation];
  if(!EDITOR_ACCEPTANCE_IDS.some((id)=>id===state.id) || !state.editor || state.start.scopeId!==LIBRARIAN_ACCEPTANCE_ID || state.start.bundle.unit.planId!==ADVISOR_ACCEPTANCE_ID || state.start.bundle.sources.length!==1 || state.start.bundle.sources[0].evidence!==STUDY_ACCEPTANCE_TEXT || state.start.bundle.exercise.text!==EDITOR_ACCEPTANCE_TASK || state.answers.some((answer)=>answer.fileIds.length!==0 || !texts.some((text)=>text===answer.text)) || state.editor.versions.some((item)=>item.parentId!==null && item.reason!==editorAcceptanceAnswers.reason) || state.questions.some((question)=>question.mode==="new-condition" && question.prompt!==EDITOR_ACCEPTANCE_VARIATION)) throw domainFailure("reference_conflict","editor.acceptance-fixed-input",null);
}
export function editorAcceptanceRequest(state:TutorState,images:readonly InputImage[]):ModelRequest {
  requireEditorAcceptance(state);if(images.length!==0) throw domainFailure("reference_conflict","editor.acceptance-no-private-images",null);
  const request=state.pending?.kind.startsWith("tutor-") ? tutorRequest(state,images) : editorRequest(state,images);
  return state.pending?.kind==="tutor-variation" ? {...request,instructions:request.instructions+` 이번 고정 검증의 prompt는 ${JSON.stringify(EDITOR_ACCEPTANCE_VARIATION)}와 정확히 일치해야 합니다. changedCondition.after는 '다섯 조각으로 나누고 두 조각'입니다. 정답은 제시하지 마세요.`} : request;
}
export function editorAcceptanceDispatcher(state:TutorState):TutorDispatcher {
  return async (runtime,input,signal)=>{
    requireEditorAcceptance(state);
    if(!state.pending || input.logicalRequestKey!==state.pending.key || input.pricing.purpose!=="prepaid-probe" || await contentHash(input.request)!==await contentHash(editorAcceptanceRequest(state,[]))) throw domainFailure("reference_conflict","editor.acceptance-request",null);
    requireDispatchPricing(input.pricing,runtime.now());const owner=await runtime.authenticate();await runtime.requireSupport(owner,await prepareAiRequest(input.request),runtime.now());return runAiAttemptSequence(runtime,input,executeAiAttempt,signal);
  };
}
