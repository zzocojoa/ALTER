import { z } from "zod";
import { recordId, version } from "../domain/contracts.ts";
import { learningConditions, availableMinutes } from "./conditions.ts";
import type { LearningConditions } from "./conditions.ts";

const text = z.string().min(1).max(2000).regex(/\S/);
export const questionMode = z.enum(["explanation", "performance"]);
export const advisorQuestion = z.object({ mode: questionMode, prompt: text }).strict();
export const submittedDiagnosis = z.object({ questionId: recordId, text: z.string().trim().min(1).max(6000), materialUsed: z.boolean(), hintUsed: z.boolean(), answerSeen: z.boolean() }).strict();
export type SubmittedDiagnosis = Readonly<z.infer<typeof submittedDiagnosis>>;
export const diagnosisAnswer = submittedDiagnosis.extend({ id: recordId, mode: questionMode }).strict();
export const diagnosticEstimate = z.object({ answerId: recordId, quote: text, interpretation: text, unverified: z.array(text).max(12), category: z.literal("diagnostic-estimate") }).strict();
export const advisorTurn = z.object({ kind: z.literal("advisor-turn"), evaluation: diagnosticEstimate.nullable(), question: advisorQuestion.nullable(), readyForPlan: z.boolean() }).strict();
export type AdvisorTurn = Readonly<z.infer<typeof advisorTurn>>;
export const proposedUnit = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/), title: text, objective: text, prerequisiteKeys: z.array(z.string()).max(12), minutes: z.number().int().positive().max(10080), selfExplanationCriterion: text, newConditionCriterion: text }).strict();
export const planProposal = z.object({ objective: text, prerequisites: z.array(text).max(12), units: z.array(proposedUnit).min(1).max(12), excludedScope: z.array(text).max(30), attention: z.array(text).max(20) }).strict();
export type PlanProposal = Readonly<z.infer<typeof planProposal>>;
export const advisorPlan = z.object({ kind: z.literal("advisor-plan"), proposal: planProposal, requiresConfirmation: z.literal(true) }).strict();
export type AdvisorPlan = Readonly<z.infer<typeof advisorPlan>>;

export const assessmentContract = z.object({
  selfExplanation: z.literal("material-hidden"), transfer: z.literal("unseen-changed-condition-unassisted"), bothRequired: z.literal(true),
  exposureHistory: z.literal("immutable-fresh-question-after-help"), delayedRecall: z.literal("separate-not-next-unit-blocking"),
  questionFlow: z.literal("one-question-wait-for-answer"), help: z.literal("direction-then-hint-then-example-then-answer"),
  editor: z.literal("one-or-two-issues-wait-for-revision-and-reason"), review: z.literal("vary-conditions"),
  weeklyAdjustment: z.literal("confirmed-evidence-only"), correction: z.literal("propagate-to-related-errors-and-reviews"),
}).strict();
export const ASSESSMENT_CONTRACT = assessmentContract.parse({ selfExplanation: "material-hidden", transfer: "unseen-changed-condition-unassisted", bothRequired: true, exposureHistory: "immutable-fresh-question-after-help", delayedRecall: "separate-not-next-unit-blocking", questionFlow: "one-question-wait-for-answer", help: "direction-then-hint-then-example-then-answer", editor: "one-or-two-issues-wait-for-revision-and-reason", review: "vary-conditions", weeklyAdjustment: "confirmed-evidence-only", correction: "propagate-to-related-errors-and-reviews" });
export const unitAssessment = z.object({ key: z.string(), selfExplanation: z.literal("미확인"), newCondition: z.literal("미확인"), delayedRecall: z.literal("미확인"), selfExplanationEvidenceId: z.null(), newConditionEvidenceId: z.null(), delayedRecallEvidenceId: z.null() }).strict();
export function unverifiedUnits(proposal: PlanProposal): z.infer<typeof unitAssessment>[] { return proposal.units.map((unit) => ({ key: unit.key, selfExplanation: "미확인", newCondition: "미확인", delayedRecall: "미확인", selfExplanationEvidenceId: null, newConditionEvidenceId: null, delayedRecallEvidenceId: null })); }
export const advisorState = z.object({ id: recordId, version, conditions: learningConditions, phase: z.enum(["diagnosis", "planning", "draft", "confirmed"]),
  question: advisorQuestion.extend({ id: recordId }).nullable(), answers: z.array(diagnosisAnswer).max(6), estimates: z.array(diagnosticEstimate).max(6),
  pending: z.object({ key: z.string(), kind: z.enum(["advisor-turn", "advisor-plan"]) }).strict().nullable(),
  draft: planProposal.nullable(), unitAssessments: z.array(unitAssessment).max(12), assessment: assessmentContract, confirmedPlanVersionId: recordId.nullable(),
}).strict();
export type AdvisorState = Readonly<z.infer<typeof advisorState>>;

/** 자기 보고와 구분하여 제출된 답변 본문에서만 인용 근거를 대조합니다. */
export function validateAdvisorTurn(value: AdvisorTurn, state: AdvisorState): void {
  const count: number = state.answers.length;
  const latest = state.answers.at(-1);
  const expectedMode: string | null = count === 0 ? "explanation" : count === 1 ? "performance" : null;
  const both: boolean = state.answers.some((answer): boolean => answer.mode === "explanation") && state.answers.some((answer): boolean => answer.mode === "performance");
  if (state.phase !== "diagnosis" || state.question !== null || state.pending?.kind !== "advisor-turn" || (expectedMode !== null && value.question?.mode !== expectedMode) || value.readyForPlan !== (value.question === null) || (value.readyForPlan && !both) || (count === 6 && !value.readyForPlan)) throw semanticFailure("diagnosis-sequence");
  if (!latest) { if (value.evaluation !== null) throw semanticFailure("unexpected-evaluation"); }
  else if (!value.evaluation || value.evaluation.answerId !== latest.id || !latest.text.includes(value.evaluation.quote)) throw semanticFailure("answer-evidence");
}

/** 사용자의 제외 범위를 유지하고 선행 단원 순서와 중복을 검증합니다. */
export function validatePlanProposal(value: PlanProposal, conditions: LearningConditions): void {
  planProposal.parse(value);
  const keys: string[] = value.units.map((unit): string => unit.key);
  if (new Set(keys).size !== keys.length || conditions.excludedScope.some((scope): boolean => !value.excludedScope.includes(scope))) throw semanticFailure("plan-scope");
  for (const [index, unit] of value.units.entries()) if (new Set(unit.prerequisiteKeys).size !== unit.prerequisiteKeys.length || unit.prerequisiteKeys.some((key): boolean => !keys.slice(0, index).includes(key))) throw semanticFailure("prerequisite-order");
}

export function planAttention(proposal: PlanProposal, conditions: LearningConditions): readonly string[] {
  const total: number = proposal.units.reduce((sum: number, unit): number => sum + unit.minutes, 0);
  return [...proposal.attention, ...(total > availableMinutes(conditions) ? [`계획 ${total}분이 기간 내 상한 ${availableMinutes(conditions)}분을 초과합니다.`] : []), "진단은 초기 추정입니다. 모든 단원의 독립 수행과 지연 재현은 미확인입니다."];
}
export function semanticFailure(rule: string): Error & Readonly<{ code: "ai_semantic_invalid"; rule: string }> {
  return Object.assign(new Error("진단 순서·근거 또는 계획 범위가 현재 기록과 맞지 않아요."), { code: "ai_semantic_invalid" as const, rule });
}
