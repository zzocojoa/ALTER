import { z } from "zod";
import { recordId, studyDate, timestamp, version } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

const errorInput = z.object({ id: recordId, unitId: recordId, answerId: recordId, concept: z.string().min(1), description: z.string().min(1) }).strict();
const reviewInput = z.object({ id: recordId, errorId: recordId, sourceRefId: recordId, question: z.string().min(1), explanation: z.string().min(1), nextAction: z.string().min(1) }).strict();
const correctionInput = z.object({ id: recordId, errorId: recordId, concept: z.string().min(1), sourceRefId: recordId, answerId: recordId, studyDate, createdAt: timestamp, reason: z.string().trim().min(1), evidence: z.string().min(1), targets: z.array(z.object({ reviewId: recordId, expectedVersion: version, question: z.string().min(1), explanation: z.string().min(1), nextAction: z.string().min(1) }).strict()).min(1) }).strict().refine((value) => new Set(value.targets.map((target) => target.reviewId)).size === value.targets.length);
const reviewAttemptInput = z.object({ id: recordId, reviewId: recordId, correctionId: recordId.nullable(), answerId: recordId, kind: z.enum(["variable", "delayed-recall"]), performedAt: timestamp }).strict();
export type ErrorInput = z.infer<typeof errorInput>;
export type ReviewInput = z.infer<typeof reviewInput>;
export type CorrectionInput = z.infer<typeof correctionInput>;
export type ReviewAttemptInput = z.infer<typeof reviewAttemptInput>;

export async function createError(db: D1Database, context: Command, value: ErrorInput): Promise<Receipt> {
  const input: ErrorInput = errorInput.parse(value);
  return executeAtomic(db, context, "error.create", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO errors VALUES (?,?,1,?,?,?,?,?)").bind(context.owner.userId, input.id, requestId, input.unitId, input.answerId, input.concept, input.description)]);
}
export async function createReview(db: D1Database, context: Command, value: ReviewInput): Promise<Receipt> {
  const input: ReviewInput = reviewInput.parse(value);
  return executeAtomic(db, context, "review.create", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO review_items VALUES (?,?,1,?,?,?,?,?,?,NULL,'required')").bind(context.owner.userId, input.id, requestId, input.errorId, input.sourceRefId, input.question, input.explanation, input.nextAction)]);
}
/** 모든 관련 복습을 명시하고 하나라도 누락·충돌하면 정정 이력까지 함께 롤백합니다. */
export async function applyCorrection(db: D1Database, context: Command, value: CorrectionInput): Promise<Receipt> {
  const input: CorrectionInput = correctionInput.parse(value);
  return executeAtomic(db, context, "correction.apply", input, input.errorId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "errors", context.owner.userId, input.errorId, context.expectedVersion, requestId, 0, "description = description", [], "concept = ? AND answer_id = ?", [input.concept, input.answerId]),
    requireInBatch(db, context.owner.userId, requestId, 1, "(SELECT count(*) FROM review_items WHERE owner_id = ? AND error_id = ?) = ?", [context.owner.userId, input.errorId, input.targets.length]),
    db.prepare("INSERT INTO corrections (owner_id,id,error_id,concept,source_ref_id,answer_id,study_date,reason,evidence,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.errorId, input.concept, input.sourceRefId, input.answerId, input.studyDate, input.reason, input.evidence, input.createdAt),
    ...input.targets.flatMap((target, index: number): D1PreparedStatement[] => [
      db.prepare("INSERT INTO correction_impacts VALUES (?,?,?,?,?,?,(SELECT question FROM review_items WHERE owner_id = ? AND id = ?),(SELECT explanation FROM review_items WHERE owner_id = ? AND id = ?),(SELECT next_action FROM review_items WHERE owner_id = ? AND id = ?))").bind(context.owner.userId, crypto.randomUUID(), input.id, target.reviewId, target.expectedVersion, target.expectedVersion + 1, context.owner.userId, target.reviewId, context.owner.userId, target.reviewId, context.owner.userId, target.reviewId),
      ...guardedUpdate(db, "review_items", context.owner.userId, target.reviewId, target.expectedVersion, requestId, index + 2, "question = ?, explanation = ?, next_action = ?, correction_id = ?, recheck_state = 'required'", [target.question, target.explanation, target.nextAction, input.id], "error_id = ? AND source_ref_id = ?", [input.errorId, input.sourceRefId]),
      db.prepare("UPDATE review_plans SET version=version+1,last_request_id=? WHERE owner_id=? AND id=?").bind(requestId,context.owner.userId,target.reviewId),
      requireInBatch(db,context.owner.userId,requestId,index+500,"NOT EXISTS(SELECT 1 FROM review_plans WHERE owner_id=? AND id=?) OR EXISTS(SELECT 1 FROM review_plans WHERE owner_id=? AND id=? AND last_request_id=?)",[context.owner.userId,target.reviewId,context.owner.userId,target.reviewId,requestId]),
    ]),
  ]);
}
export async function recordReviewAttempt(db: D1Database, context: Command, value: ReviewAttemptInput): Promise<Receipt> {
  const input: ReviewAttemptInput = reviewAttemptInput.parse(value);
  const state: string = input.kind === "variable" ? "independent" : "delayed";
  return executeAtomic(db, context, "review.attempt", input, input.reviewId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "review_items", context.owner.userId, input.reviewId, context.expectedVersion, requestId, 0, "recheck_state = ?", [state], "correction_id IS ? AND (? = 'variable' OR recheck_state = 'independent')", [input.correctionId, input.kind]),
    db.prepare("INSERT INTO review_attempts VALUES (?,?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.reviewId, input.correctionId, input.answerId, input.kind, input.performedAt),
  ]);
}
