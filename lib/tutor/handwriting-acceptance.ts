import { createTutorProbeDispatcher } from "./probe-dispatch.ts";
import { handwritingProbeApproval } from "../ai/configuration.ts";
import type { HandwritingProbeApproval } from "../ai/configuration.ts";
import { prepareAiRequest } from "../ai/request-bound.ts";
import type { ModelRequest, PreparedAiRequest, InputImage } from "../ai/request-bound.ts";
import { contentHash, domainFailure } from "../domain/contracts.ts";
import { hashFile } from "../learning-upload.ts";
import { ADVISOR_ACCEPTANCE_ID } from "../advisor/acceptance.ts";
import { LIBRARIAN_ACCEPTANCE_IDS, STUDY_ACCEPTANCE_TEXT } from "../librarian/acceptance-fixture.ts";
import { dispatchTutor, tutorRequest } from "./ai.ts";
import type { TutorDispatcher } from "./ai.ts";
import type { TutorState } from "./contracts.ts";

/** 서버에서 승인한 사진 한 장과 전체 요청이 일치할 때만 시험 판독을 허용합니다. */
export async function requireHandwritingProbe(state: TutorState, approval: HandwritingProbeApproval, request: ModelRequest, now: number): Promise<PreparedAiRequest> {
  const verified: HandwritingProbeApproval = handwritingProbeApproval.parse(approval);
  const answer = state.answers.find((item): boolean => item.id === state.currentAnswerId);
  if (verified.approvedAt > now || verified.validUntil <= now || state.id !== verified.sessionId || state.editor || state.review || state.pending?.kind !== "tutor-diagnosis" || state.phase !== "evaluating" || !answer || state.answers.some((item): boolean => item.text !== "" || item.fileIds.length !== 1 || item.fileIds[0] !== verified.materialId || item.questionId !== state.question.id) || answer.questionId !== state.question.id || answer.attemptId !== state.question.attemptId || answer.text !== "" || answer.fileIds.length !== 1 || answer.fileIds[0] !== verified.materialId || state.questions.length !== 1 || state.question.mode !== "self-explanation" || state.question.prompt !== state.start.bundle.question.text || state.help.length !== 0 || state.variations.length !== 0 || state.lesson !== null) throw domainFailure("reference_conflict", "tutor.handwriting-approved-answer", null);
  if (!LIBRARIAN_ACCEPTANCE_IDS.some((id): boolean => id === state.start.scopeId) || state.start.bundle.unit.planId !== ADVISOR_ACCEPTANCE_ID || state.start.bundle.sources.length !== 1 || state.start.bundle.sources[0].evidence !== STUDY_ACCEPTANCE_TEXT) throw domainFailure("reference_conflict", "tutor.handwriting-fixed-source", null);
  const prepared: PreparedAiRequest = await prepareAiRequest(request);
  const images: InputImage[] = prepared.request.messages.flatMap((message): InputImage[] => message.content.filter((part): part is InputImage => part.type === "input_image"));
  if (images.length !== 1 || images[0].sourceRefId !== verified.materialId || prepared.requestFingerprint !== verified.requestFingerprint || await contentHash(request) !== await contentHash(tutorRequest(state, images))) throw domainFailure("reference_conflict", "tutor.handwriting-request-fingerprint", null);
  const image: InputImage = images[0];
  const bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(atob(image.dataUrl.slice(image.dataUrl.indexOf(",") + 1)), (character: string): number => character.charCodeAt(0));
  if (await hashFile(bytes.buffer) !== verified.imageSha256) throw domainFailure("reference_conflict", "tutor.handwriting-image-hash", null);
  return prepared;
}

/** 승인 없는 회차는 일반 가격 검증을 유지하고 시험 호출도 기존 비용·복구 경로를 공유합니다. */
export function approvedTutorDispatcher(state: TutorState, approval: HandwritingProbeApproval | undefined): TutorDispatcher {
  if (!approval || approval.sessionId !== state.id) return dispatchTutor;
  return createTutorProbeDispatcher(state, (request, now): Promise<PreparedAiRequest> => requireHandwritingProbe(state, approval, request, now));
}
