import { domainFailure, recordId } from "../domain/contracts.ts";
import { learningConditions } from "./conditions.ts";
import type { LearningConditions } from "./conditions.ts";
import { ASSESSMENT_CONTRACT, advisorState, submittedDiagnosis, validateAdvisorTurn, validatePlanProposal, unverifiedUnits } from "./contracts.ts";
import type { AdvisorState, AdvisorTurn, PlanProposal, SubmittedDiagnosis } from "./contracts.ts";

export function initialAdvisor(id: string, conditions: LearningConditions): AdvisorState {
  return advisorState.parse({ id, version: 1, conditions: learningConditions.parse(conditions), phase: "diagnosis", question: null, answers: [], estimates: [], pending: null, draft: null, unitAssessments: [], assessment: ASSESSMENT_CONTRACT, confirmedPlanVersionId: null });
}
export function answerDiagnosis(state: AdvisorState, answerId: string, value: SubmittedDiagnosis): AdvisorState {
  const input: SubmittedDiagnosis = submittedDiagnosis.parse(value);
  if (state.phase !== "diagnosis" || state.pending || !state.question || state.question.id !== input.questionId) throw domainFailure("version_conflict", "advisor.answer.current-question", null);
  return advisorState.parse({ ...state, version: state.version + 1, question: null, answers: [...state.answers, { ...input, id: recordId.parse(answerId), mode: state.question.mode }] });
}
export function beginAdvisorAi(state: AdvisorState): AdvisorState {
  if (state.pending || state.question || !["diagnosis", "planning"].includes(state.phase)) throw domainFailure("version_conflict", "advisor.ai.phase", null);
  return advisorState.parse({ ...state, version: state.version + 1, pending: { key: `advisor:${state.id}:${state.version}`, kind: state.phase === "diagnosis" ? "advisor-turn" : "advisor-plan" } });
}
export function finishAdvisorTurn(state: AdvisorState, value: AdvisorTurn, questionId: string): AdvisorState {
  validateAdvisorTurn(value, state);
  return advisorState.parse({ ...state, version: state.version + 1, pending: null, phase: value.readyForPlan ? "planning" : "diagnosis", question: value.question ? { ...value.question, id: recordId.parse(questionId) } : null, estimates: value.evaluation ? [...state.estimates, value.evaluation] : state.estimates });
}
export function finishAdvisorPlan(state: AdvisorState, proposal: PlanProposal): AdvisorState {
  if (state.phase !== "planning" || state.pending?.kind !== "advisor-plan" || state.answers.length < 2 || state.estimates.length !== state.answers.length) throw domainFailure("version_conflict", "advisor.plan.phase", null);
  validatePlanProposal(proposal, state.conditions);
  return advisorState.parse({ ...state, version: state.version + 1, phase: "draft", pending: null, draft: proposal, unitAssessments: unverifiedUnits(proposal) });
}
export function editAdvisorPlan(state: AdvisorState, proposal: PlanProposal): AdvisorState {
  if (state.phase !== "draft" || state.pending) throw domainFailure("version_conflict", "advisor.edit.phase", null);
  validatePlanProposal(proposal, state.conditions);
  return advisorState.parse({ ...state, version: state.version + 1, draft: proposal, unitAssessments: unverifiedUnits(proposal) });
}
