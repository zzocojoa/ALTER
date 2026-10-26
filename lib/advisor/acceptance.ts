import { contentHash, domainFailure } from "../domain/contracts.ts";
import { learningConditions } from "./conditions.ts";
import type { AdvisorState, SubmittedDiagnosis } from "./contracts.ts";
import { advisorRequest } from "./ai.ts";
import type { AdvisorDispatcher } from "./ai.ts";
import { executeAiAttempt } from "../ai/attempt.ts";
import { runAiAttemptSequence } from "../ai/run.ts";
import { prepareAiRequest } from "../ai/request-bound.ts";
import { requireDispatchPricing } from "../ai/pricing.ts";

export const ADVISOR_ACCEPTANCE_ID = "00000000-0000-4000-a000-000000000707";
export const ADVISOR_ACCEPTANCE_CONDITIONS = learningConditions.parse({ title: "Task 7 Advisor 검증", domain: "major", purpose: "분수의 의미와 간단한 분수 계산을 배우기 위한 시험용 학습계획", selfReportedLevel: "기초 학습자. 계산 능력은 아직 확인되지 않음.", minutesPerWeek: 120, startDate: "2026-10-24", endDate: "2026-11-20", excludedScope: ["미적분", "새 교재 전체 분석"] });
/** 실제 사용자 답변 대신 승인된 고정 시험 응답만 전송합니다. */
export function acceptanceAnswer(state: AdvisorState): SubmittedDiagnosis {
  if (!state.question) throw domainFailure("reference_conflict", "advisor.acceptance.question", null);
  return { questionId: state.question.id, text: state.question.mode === "explanation" ? "분수는 전체를 같은 크기로 나눈 부분을 나타낸다고 알고 있습니다. 질문의 자세한 내용은 아직 스스로 설명하지 못하겠습니다." : "제시된 문제를 혼자 풀지 못했습니다. 계산 능력은 미확인으로 남겨 주세요.", materialUsed: false, hintUsed: false, answerSeen: false };
}
export async function requireAdvisorAcceptance(state: AdvisorState): Promise<void> {
  if (state.id !== ADVISOR_ACCEPTANCE_ID || await contentHash(state.conditions) !== await contentHash(ADVISOR_ACCEPTANCE_CONDITIONS)) throw domainFailure("reference_conflict", "advisor.acceptance.fixed-conditions", null);
  for (const answer of state.answers) {
    const expected: SubmittedDiagnosis = acceptanceAnswer({ ...state, question: { id: answer.questionId, mode: answer.mode, prompt: "시험" } });
    if (answer.text !== expected.text || answer.materialUsed || answer.hintUsed || answer.answerSeen) throw domainFailure("reference_conflict", "advisor.acceptance.fixed-answers", null);
  }
}
/** 고정 시험만 기존 누적 소액 원장으로 실행하며 일반 학습의 가격 검사를 완화하지 않습니다. */
export function advisorAcceptanceDispatcher(state: AdvisorState): AdvisorDispatcher {
  return async (runtime, input, signal) => {
    await requireAdvisorAcceptance(state);
    if (!state.pending || input.logicalRequestKey !== state.pending.key || input.pricing.purpose !== "prepaid-probe" || await contentHash(input.request) !== await contentHash(advisorRequest(state))) throw domainFailure("reference_conflict", "advisor.acceptance.request", null);
    requireDispatchPricing(input.pricing, runtime.now());
    const owner = await runtime.authenticate();
    await runtime.requireSupport(owner, await prepareAiRequest(input.request), runtime.now());
    return runAiAttemptSequence(runtime, input, executeAiAttempt, signal);
  };
}
