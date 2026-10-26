import { startAdvisor, beginStoredAdvisorAi, getAdvisor, saveAdvisorTurn, submitAdvisorAnswer, saveAdvisorPlan, confirmAdvisorPlan } from "../../db/repositories/advisor.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { learningConditions } from "../../lib/advisor/conditions.ts";
import type { AdvisorState } from "../../lib/advisor/contracts.ts";

/** 자료 소비 기능 검사에 필요한 계획만 실제 Advisor 저장 경로로 준비합니다. */
export async function confirmedPlanFixture(db: D1Database, owner: SiteIdentity): Promise<AdvisorState> {
  return confirmedPlanFixtureWithId(db, owner, crypto.randomUUID());
}
export async function confirmedPlanFixtureWithId(db: D1Database, owner: SiteIdentity, id: string): Promise<AdvisorState> {
  const cmd = (expectedVersion: number) => ({ owner, requestKey: crypto.randomUUID(), expectedVersion });
  await startAdvisor(db, cmd(1), id, learningConditions.parse({ title: "분수 시험 계획", domain: "major", purpose: "분수 의미와 계산", selfReportedLevel: "기초 수준이라는 자기 보고", minutesPerWeek: 120, startDate: "2026-10-24", endDate: "2026-11-20", excludedScope: ["미적분"] }));
  for (let index: number = 0; index < 3; index += 1) {
    let state = await getAdvisor(db, owner, id); await beginStoredAdvisorAi(db, cmd(state.version), id); state = await getAdvisor(db, owner, id);
    const answer = state.answers.at(-1);
    await saveAdvisorTurn(db, owner, state, { kind: "advisor-turn", evaluation: answer ? { answerId: answer.id, quote: answer.text, interpretation: "시험용 초기 추정", unverified: ["독립 수행"], category: "diagnostic-estimate" } : null, question: index===2 ? null : { mode: index===0 ? "explanation" : "performance", prompt: "분수의 의미를 설명하거나 1/4+1/4을 계산해 주세요." }, readyForPlan: index===2 });
    state = await getAdvisor(db, owner, id);
    if (state.question) await submitAdvisorAnswer(db, cmd(state.version), id, { questionId: state.question.id, text: "아직 모르겠습니다.", materialUsed: false, hintUsed: false, answerSeen: false });
  }
  let state = await getAdvisor(db, owner, id); await beginStoredAdvisorAi(db, cmd(state.version), id); state = await getAdvisor(db, owner, id);
  await saveAdvisorPlan(db, owner, state, { objective: "분수 이해", prerequisites: ["자연수"], units: [{ key: "meaning", title: "분수의 의미", objective: "분수의 의미를 설명한다", prerequisiteKeys: [], minutes: 60, selfExplanationCriterion: "자료 없이 분자와 분모 설명", newConditionCriterion: "새 조각 문제를 도움 없이 풀이" }, { key: "addition", title: "분수의 덧셈", objective: "같은 분모 덧셈", prerequisiteKeys: ["meaning"], minutes: 60, selfExplanationCriterion: "분모가 같은 덧셈 설명", newConditionCriterion: "새 덧셈 문제 독립 수행" }], excludedScope: ["미적분"], attention: ["독립 수행 미확인"] });
  state = await getAdvisor(db, owner, id);
  await confirmAdvisorPlan(db, cmd(state.version), id, { reviewedVersion: state.version, reviewedEvidence: true, acceptedAssessment: true, acceptedScopeAndTime: true });
  return getAdvisor(db, owner, id);
}
