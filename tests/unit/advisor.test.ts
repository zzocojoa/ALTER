import { ADVISOR_ACCEPTANCE_CONDITIONS, ADVISOR_ACCEPTANCE_ID, requireAdvisorAcceptance } from "../../lib/advisor/acceptance.ts";
import { describe, it, expect } from "vitest";
import { availableMinutes, learningConditions } from "../../lib/advisor/conditions.ts";
import { initialAdvisor, beginAdvisorAi, answerDiagnosis, finishAdvisorTurn } from "../../lib/advisor/state.ts";
import { ASSESSMENT_CONTRACT, assessmentContract, validateAdvisorTurn, validatePlanProposal, planAttention } from "../../lib/advisor/contracts.ts";
import type { AdvisorTurn, PlanProposal } from "../../lib/advisor/contracts.ts";
import { recordId, seoulStudyDate } from "../../lib/domain/contracts.ts";
import { prepareAiRequest } from "../../lib/ai/request-bound.ts";

const id = recordId.parse("00000000-0000-4000-8000-000000000701");
const conditions = learningConditions.parse({ title: "분수", domain: "major", purpose: "분수 계산", selfReportedLevel: "처음", minutesPerWeek: 60, startDate: "2026-10-24", endDate: "2026-10-30", excludedScope: ["미적분"] });
const first: AdvisorTurn = { kind: "advisor-turn", evaluation: null, question: { mode: "explanation", prompt: "분모를 설명해 주세요." }, readyForPlan: false };
const proposal: PlanProposal = { objective: "분수 이해", prerequisites: ["자연수"], units: [{ key: "a", title: "분수", objective: "분수 이해", prerequisiteKeys: [], minutes: 60, selfExplanationCriterion: "분모 설명", newConditionCriterion: "새 분수 비교" }], excludedScope: ["미적분"], attention: [] };
describe("Advisor 조건", () => {
  it("서울 날짜와 기간 내 분 단위를 고정한다", () => { expect(seoulStudyDate(Date.parse("2026-10-23T15:01:00Z"))).toBe("2026-10-24"); expect(availableMinutes(conditions)).toBe(60); });
  it.each([0, -1, 1.5, 10081])("잘못된 시간 %s 거부", (minutesPerWeek) => { expect(learningConditions.safeParse({ ...conditions, minutesPerWeek }).success).toBe(false); });
  it("날짜 역전과 없는 날짜 및 미지 필드 거부", () => { for (const update of [{ endDate: "2026-10-01" }, { startDate: "2026-02-30" }, { ownerId: "other" }]) expect(learningConditions.safeParse({ ...conditions, ...update }).success).toBe(false); });
});
describe("한 질문씩 진단", () => {
  it("답변 전 다음 질문 요청을 막고 원본을 바꾸지 않는다", () => {
    const original = initialAdvisor(id, conditions); const pending = beginAdvisorAi(original); const waiting = finishAdvisorTurn(pending, first, id);
    expect(original.version).toBe(1); expect(original.question).toBeNull(); expect(() => beginAdvisorAi(waiting)).toThrow();
    const answered = answerDiagnosis(waiting, id, { questionId: id, text: "분모는 전체 조각 수", materialUsed: true, hintUsed: false, answerSeen: false });
    expect(waiting.answers).toHaveLength(0); expect(answered.answers[0].materialUsed).toBe(true); expect(answered.question).toBeNull();
    expect(() => answerDiagnosis(answered, id, answered.answers[0])).toThrow();
  });
  it("순서 위조와 근거 없는 완료를 거부한다", () => { const pending = beginAdvisorAi(initialAdvisor(id, conditions)); expect(() => validateAdvisorTurn({ ...first, question: { mode: "performance", prompt: "수행" } }, pending)).toThrow(); expect(() => validateAdvisorTurn({ ...first, readyForPlan: true }, pending)).toThrow(); });
  it("추가 진단과 종료를 분기하고 여섯 답변에서 중단한다", () => {
    const answer = { id, questionId: id, mode: "explanation" as const, text: "근거", materialUsed: false, hintUsed: false, answerSeen: false };
    const pending = beginAdvisorAi({ ...initialAdvisor(id, conditions), answers: [answer, { ...answer, mode: "performance" }] });
    const extra: AdvisorTurn = { kind: "advisor-turn", evaluation: { answerId: id, quote: "근거", interpretation: "추가 확인 필요", unverified: ["응용"], category: "diagnostic-estimate" }, question: { mode: "performance", prompt: "변경된 조건에서 계산해 주세요." }, readyForPlan: false };
    expect(() => validateAdvisorTurn(extra, pending)).not.toThrow();
    expect(() => validateAdvisorTurn({ ...extra, question: null, readyForPlan: true }, pending)).not.toThrow();
    expect(() => validateAdvisorTurn(extra, { ...pending, answers: [...pending.answers, answer, answer, answer, answer] })).toThrow();
  });
  it("자기 보고를 제출 답변 인용으로 오인하지 않는다", () => {
    const answered = answerDiagnosis(finishAdvisorTurn(beginAdvisorAi(initialAdvisor(id, conditions)), first, id), id, { questionId: id, text: "모르겠어요", materialUsed: false, hintUsed: false, answerSeen: false });
    const pending = beginAdvisorAi(answered);
    expect(() => validateAdvisorTurn({ kind: "advisor-turn", question: { mode: "performance", prompt: "비교해 주세요" }, readyForPlan: false, evaluation: { answerId: id, quote: "처음", interpretation: "추정", unverified: ["계산"], category: "diagnostic-estimate" } }, pending)).toThrow();
  });
});
describe("계획과 필수 통과 계약", () => {
  it("제외 범위·선행 순서·단원 키를 검사한다", () => {
    expect(() => validatePlanProposal(proposal, conditions)).not.toThrow();
    expect(() => validatePlanProposal({ ...proposal, excludedScope: [] }, conditions)).toThrow();
    expect(() => validatePlanProposal({ ...proposal, units: [{ ...proposal.units[0], prerequisiteKeys: ["a"] }] }, conditions)).toThrow();
    expect(() => validatePlanProposal({ ...proposal, units: [proposal.units[0], proposal.units[0]] }, conditions)).toThrow();
  });
  it("시간 초과와 미확인을 숨기지 않는다", () => { expect(planAttention({ ...proposal, units: [{ ...proposal.units[0], minutes: 61 }] }, conditions).join(" ")).toContain("초과"); });
  it("두 통과 요건과 도움 이력·지연 재현 구분을 약화할 수 없다", () => { for (const patch of [{ bothRequired: false }, { delayedRecall: "required" }, { exposureHistory: "delete" }, { editor: "automatic" }]) expect(assessmentContract.safeParse({ ...ASSESSMENT_CONTRACT, ...patch }).success).toBe(false); });
  it("Advisor 스키마를 공통 비용 집계 요청에 넣는다", async () => { const prepared = await prepareAiRequest({ responseContract: "advisor-turn", instructions: "질문 하나", messages: [{ role: "user", content: [{ type: "input_text", text: "진단" }] }], maximumOutputTokens: 1800, reasoningEffort: "none" }); expect(JSON.stringify(prepared.body.text)).toContain("alter_advisor_turn"); expect(prepared.body.model).toBe("gpt-6-luna"); });
});

describe("실제 호출 승인 범위", () => {
  it("시험 기록 ID와 입력 조건이 모두 고정돼야 한다", async () => {
    const state = initialAdvisor(ADVISOR_ACCEPTANCE_ID, ADVISOR_ACCEPTANCE_CONDITIONS);
    await expect(requireAdvisorAcceptance(state)).resolves.toBeUndefined();
    await expect(requireAdvisorAcceptance({ ...state, id })).rejects.toThrow();
    await expect(requireAdvisorAcceptance({ ...state, conditions: { ...state.conditions, purpose: "범위 밖" } })).rejects.toThrow();
  });
});
