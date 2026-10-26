import { contentHash, domainFailure } from "../domain/contracts.ts";
import type { ScopeState } from "./contracts.ts";
import { librarianRequest } from "./ai.ts";
import type { LibrarianDispatcher } from "./ai.ts";
import { executeAiAttempt } from "../ai/attempt.ts";
import { runAiAttemptSequence } from "../ai/run.ts";
import { prepareAiRequest } from "../ai/request-bound.ts";
import { requireDispatchPricing } from "../ai/pricing.ts";
import { ADVISOR_ACCEPTANCE_ID } from "../advisor/acceptance.ts";
import { LIBRARIAN_ACCEPTANCE_IDS, LIBRARIAN_ACCEPTANCE_LINK_ID, LIBRARIAN_HELP_ACCEPTANCE_ID, LIBRARIAN_HELP_LINK_ID, LIBRARIAN_HELP_UNIT_TITLE, STUDY_ACCEPTANCE_TEXT, STUDY_ACCEPTANCE_TITLE } from "./acceptance-fixture.ts";

export function requireLibrarianAcceptance(state: ScopeState): void {
  const expectedLinkId: string = state.input.id === LIBRARIAN_HELP_ACCEPTANCE_ID ? LIBRARIAN_HELP_LINK_ID : LIBRARIAN_ACCEPTANCE_LINK_ID;
  const unitMatches: boolean = state.input.id === LIBRARIAN_HELP_ACCEPTANCE_ID ? state.unit.title === LIBRARIAN_HELP_UNIT_TITLE && state.unit.prerequisiteUnitIds.length === 1 : state.unit.prerequisiteUnitIds.length === 0;
  const candidate = state.candidates[0];
  if (!LIBRARIAN_ACCEPTANCE_IDS.some((id): boolean => id === state.input.id) || state.unit.planId !== ADVISOR_ACCEPTANCE_ID || !unitMatches || state.input.availableMinutes !== 30 || state.input.questionMinutes !== 5 || state.input.practiceMinutes !== 10 || state.candidates.length !== 1 || !candidate || candidate.link.id !== expectedLinkId || candidate.link.metadata.title !== STUDY_ACCEPTANCE_TITLE || candidate.link.metadata.edition !== "시험 1판" || candidate.link.toc !== "분수의 뜻과 같은 분모 덧셈" || candidate.link.bibliography.author !== "ALTER" || candidate.link.bibliography.origin !== "자체 작성 시험 자료" || !candidate.link.bibliography.checked || candidate.sources.length !== 1 || candidate.sources[0].evidence !== STUDY_ACCEPTANCE_TEXT || !candidate.valid) throw domainFailure("reference_conflict", "librarian.acceptance-fixed-input", null);
}
/** 기존 누적 소액 원장을 재사용하며 재시도도 각각 예약합니다. 일반 자료의 가격 검사는 유지합니다. */
export function librarianAcceptanceDispatcher(state: ScopeState): LibrarianDispatcher {
  return async (runtime, input, signal) => {
    requireLibrarianAcceptance(state);
    if (!state.pendingKey || input.logicalRequestKey !== state.pendingKey || input.pricing.purpose !== "prepaid-probe" || await contentHash(input.request) !== await contentHash(librarianRequest(state))) throw domainFailure("reference_conflict", "librarian.acceptance-request", null);
    requireDispatchPricing(input.pricing, runtime.now());
    const owner = await runtime.authenticate(); await runtime.requireSupport(owner, await prepareAiRequest(input.request), runtime.now());
    return runAiAttemptSequence(runtime, input, executeAiAttempt, signal);
  };
}
