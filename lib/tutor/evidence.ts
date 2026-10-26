import { hasTutorDiagnosisConflict } from "./diagnosis.ts";
import { normalizedPerformanceText } from "./identity.ts";
import { TUTOR_DIRECTION_TEXT,TUTOR_DIRECTION_PROMPT } from "./direction.ts";
import { domainFailure } from "../domain/contracts.ts";
import type { TutorOutput, TutorState } from "./contracts.ts";

/** 확정된 구간에 실제로 존재하는 인용만 수용하며 생성 문장을 원문으로 승격하지 않습니다. */
export function validateTutorEvidence(state: TutorState, output: TutorOutput): void {
  if(output.kind==="tutor-scaffold" && output.stage==="direction" && (output.explanation.text!==TUTOR_DIRECTION_TEXT || output.learnerPrompt!==TUTOR_DIRECTION_PROMPT)) throw domainFailure("reference_conflict","tutor.direction-answer-exposure",null);
  if(output.kind==="tutor-diagnosis" && hasTutorDiagnosisConflict(output)) throw domainFailure("reference_conflict","tutor.diagnosis-conflicting-verdict",null);
  const citations = "explanation" in output ? output.explanation.citations : output.citations;
  if (citations.length === 0 || citations.some((citation): boolean => !state.start.bundle.sources.some((source): boolean => source.id === citation.sourceRefId && citation.quote.trim().length > 0 && source.evidence.includes(citation.quote)))) throw domainFailure("reference_conflict", "tutor.exact-source-quote-required", null);
  if (output.kind === "tutor-diagnosis" || output.kind === "tutor-scaffold") {
    if (output.questionId !== state.question.id || output.answerId !== state.currentAnswerId || !state.answers.some((answer): boolean => answer.id === output.answerId && answer.questionId === output.questionId)) throw domainFailure("reference_conflict", "tutor.saved-answer-required", null);
  }
  if (output.kind === "tutor-diagnosis" && (output.readability === "unreadable" ? output.correct !== null || !output.needsHelp : output.correct === null)) throw domainFailure("reference_conflict", "tutor.diagnosis-readability", null);
  if (output.kind === "tutor-variation" && (output.originalQuestionId !== state.question.id || normalizedPerformanceText(output.prompt) === normalizedPerformanceText(state.question.prompt) || normalizedPerformanceText(output.changedCondition.before) === normalizedPerformanceText(output.changedCondition.after) || !state.question.prompt.includes(output.changedCondition.before) || !output.prompt.includes(output.changedCondition.after) || !/[\p{L}\p{N}]/u.test(output.changedCondition.before) || !/[\p{L}\p{N}]/u.test(output.changedCondition.after))) throw domainFailure("reference_conflict", "tutor.new-condition-required", null);
}
