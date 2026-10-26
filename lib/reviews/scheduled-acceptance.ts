import { scheduledReviewProbeApproval } from "../ai/configuration.ts";
import type { ScheduledReviewProbeApproval } from "../ai/configuration.ts";
import { prepareAiRequest } from "../ai/request-bound.ts";
import type { ModelRequest, PreparedAiRequest } from "../ai/request-bound.ts";
import { contentHash, domainFailure, seoulStudyDate } from "../domain/contracts.ts";
import { ADVISOR_ACCEPTANCE_ID } from "../advisor/acceptance.ts";
import { LIBRARIAN_ACCEPTANCE_IDS, STUDY_ACCEPTANCE_TEXT } from "../librarian/acceptance-fixture.ts";
import { tutorRequest } from "../tutor/ai.ts";
import type { TutorDispatcher } from "../tutor/ai.ts";
import { createTutorProbeDispatcher } from "../tutor/probe-dispatch.ts";
import type { TutorState } from "../tutor/contracts.ts";
import { beginTutorDiagnosis } from "../tutor/state.ts";

/** 실제 예정일에 저장한 새 답안만 승인된 요청과 대조하며 날짜·답안을 대신 만들지 않습니다. */
export async function requireScheduledReviewProbe(state: TutorState, approval: ScheduledReviewProbeApproval, request: ModelRequest, now: number): Promise<PreparedAiRequest> {
  const verified: ScheduledReviewProbeApproval = scheduledReviewProbeApproval.parse(approval);
  const answer = state.answers.find((item): boolean => item.id === state.currentAnswerId);
  const review = state.review;
  if (state.id !== verified.sessionId || !review || state.editor || state.phase !== "evaluating" || state.pending?.kind !== "tutor-diagnosis" || !answer || state.answers.some((item): boolean => item.fileIds.length !== 0 || item.questionId !== state.question.id) || answer.text.trim().length === 0 || answer.fileIds.length !== 0 || answer.helped || state.questions.length !== 1 || state.help.length !== 0 || state.lesson !== null || state.variations.length !== 0 || state.question.prompt !== review.task.prompt || answer.questionId !== state.question.id || answer.attemptId !== state.question.attemptId) throw domainFailure("reference_conflict", "review.probe-saved-text-answer", null);
  if (review.reviewId !== verified.reviewId || review.scheduleId !== verified.scheduleId || review.basisResultVersionId !== verified.basisResultVersionId || review.dueDate !== verified.dueDate || review.task.type !== "concept" || !LIBRARIAN_ACCEPTANCE_IDS.some((id): boolean => id === state.start.scopeId) || state.start.bundle.unit.planId !== ADVISOR_ACCEPTANCE_ID || state.start.bundle.sources.length !== 1 || state.start.bundle.sources[0].evidence !== STUDY_ACCEPTANCE_TEXT) throw domainFailure("reference_conflict", "review.probe-fixed-schedule-source", null);
  const today: string = seoulStudyDate(now);
  const submittedDate: string = seoulStudyDate(answer.submittedAt);
  const baselineDate: string = seoulStudyDate(review.baselineAt);
  if (verified.approvedAt > now || verified.validUntil <= now || verified.approvedAt < answer.submittedAt || answer.submittedAt > now || today < verified.notBeforeDate || today < review.dueDate || state.start.today > today || state.start.today < review.dueDate || state.start.today <= baselineDate || submittedDate < review.dueDate || submittedDate < verified.notBeforeDate || submittedDate <= baselineDate) throw domainFailure("reference_conflict", "review.probe-actual-seoul-date-required", null);
  const prepared: PreparedAiRequest = await prepareAiRequest(request);
  if (prepared.imageCount !== 0 || prepared.requestFingerprint !== verified.requestFingerprint || await contentHash(request) !== await contentHash(tutorRequest(state, []))) throw domainFailure("reference_conflict", "review.probe-request-fingerprint", null);
  return prepared;
}

/** 복습 진단의 승인 범위만 추가하고 예산·지원·원본 검사를 우회하지 않습니다. */
export function scheduledReviewProbeDispatcher(state: TutorState, approval: ScheduledReviewProbeApproval): TutorDispatcher {
  return createTutorProbeDispatcher(state, (request, now): Promise<PreparedAiRequest> => requireScheduledReviewProbe(state, approval, request, now));
}

/** 저장된 시험 답안으로 승인 후보만 만들며 DB·환경 설정·외부 호출은 변경하지 않습니다. */
export async function prepareScheduledReviewApproval(saved: TutorState, now: number, validUntil: number): Promise<ScheduledReviewProbeApproval> {
  const state: TutorState = beginTutorDiagnosis(saved);
  if (!state.review) throw domainFailure("reference_conflict", "review.probe-review-required", null);
  const request: ModelRequest = tutorRequest(state, []);
  const prepared: PreparedAiRequest = await prepareAiRequest(request);
  const approval: ScheduledReviewProbeApproval = scheduledReviewProbeApproval.parse({ sessionId: state.id, reviewId: state.review.reviewId, scheduleId: state.review.scheduleId, basisResultVersionId: state.review.basisResultVersionId, dueDate: state.review.dueDate, notBeforeDate: "2026-10-26", requestFingerprint: prepared.requestFingerprint, approvedAt: now, validUntil });
  await requireScheduledReviewProbe(state, approval, request, now);
  return approval;
}
