import { z } from "zod";
import { draftAnswer, recordId, studyDate, timestamp } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

const sessionInput = z.object({ id: recordId, courseId: recordId, unitId: recordId, planVersionId: recordId, studyDate }).strict();
const questionInput = z.object({ id: recordId, sessionId: recordId, sourceRefId: recordId.nullable(), prompt: z.string().min(1) }).strict();
const attemptInput = z.object({ id: recordId, sessionId: recordId, questionId: recordId, originalQuestionId: recordId.nullable(), mode: z.enum(["initial", "new-condition", "delayed-recall"]), hiddenMaterial: z.boolean() }).strict();
const answerInput = z.object({ id: recordId, attemptId: recordId, text: z.string().min(1), submittedAt: timestamp }).strict();
const helpInput = z.object({ id: recordId, attemptId: recordId, kind: z.enum(["hint", "answer", "explanation"]), level: z.number().int().min(1).max(3), shownAt: timestamp }).strict();
const feedbackInput = z.object({ attemptId: recordId, answerId: recordId, items: z.array(z.object({ id: recordId, content: z.string().min(1) }).strict()).min(1).max(2) }).strict();
const revisionInput = z.object({ id: recordId, attemptId: recordId, answerId: recordId, feedbackId: recordId, text: z.string().min(1), reason: z.string().trim().min(1), submittedAt: timestamp }).strict();
export type SessionInput = z.infer<typeof sessionInput>;
export type QuestionInput = z.infer<typeof questionInput>;
export type AttemptInput = z.infer<typeof attemptInput>;
export type AnswerInput = z.infer<typeof answerInput>;
export type HelpInput = z.infer<typeof helpInput>;
export type FeedbackInput = z.infer<typeof feedbackInput>;
export type RevisionInput = z.infer<typeof revisionInput>;

export async function createSession(db: D1Database, context: Command, value: SessionInput): Promise<Receipt> {
  const input: SessionInput = sessionInput.parse(value);
  return executeAtomic(db, context, "session.create", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO sessions VALUES (?,?,1,?,?,?,?,?,'active')").bind(context.owner.userId, input.id, requestId, input.courseId, input.unitId, input.planVersionId, input.studyDate)]);
}
export async function pauseSession(db: D1Database, context: Command, id: string): Promise<Receipt> {
  recordId.parse(id); return executeAtomic(db, context, "session.pause", { id }, id, context.expectedVersion + 1, (requestId: string) => guardedUpdate(db, "sessions", context.owner.userId, id, context.expectedVersion, requestId, 0, "status = 'paused'", [], "status = 'active'", []));
}
export async function resumeSession(db: D1Database, context: Command, id: string): Promise<Receipt> {
  recordId.parse(id); return executeAtomic(db, context, "session.resume", { id }, id, context.expectedVersion + 1, (requestId: string) => guardedUpdate(db, "sessions", context.owner.userId, id, context.expectedVersion, requestId, 0, "status = 'active'", [], "status = 'paused'", []));
}
export async function createQuestion(db: D1Database, context: Command, value: QuestionInput): Promise<Receipt> {
  const input: QuestionInput = questionInput.parse(value);
  return executeAtomic(db, context, "question.create", input, input.id, 1, () => [db.prepare("INSERT INTO questions VALUES (?,?,?,?,?)").bind(context.owner.userId, input.id, input.sessionId, input.sourceRefId, input.prompt)]);
}
export async function startAttempt(db: D1Database, context: Command, value: AttemptInput): Promise<Receipt> {
  const input: AttemptInput = attemptInput.parse(value);
  return executeAtomic(db, context, "attempt.create", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO attempts VALUES (?,?,1,?,?,?,?,?,?,'awaiting-answer')").bind(context.owner.userId, input.id, requestId, input.sessionId, input.questionId, input.originalQuestionId, input.mode, Number(input.hiddenMaterial))]);
}
export async function saveAnswerDraft(db: D1Database, context: Command, attemptId: string, text: string): Promise<Receipt> {
  recordId.parse(attemptId); draftAnswer.parse({ kind: "draft", text, expectedVersion: context.expectedVersion });
  return executeAtomic(db, context, "answer.draft", { text }, attemptId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "attempts", context.owner.userId, attemptId, context.expectedVersion, requestId, 0, "status = status", [], "status = 'awaiting-answer'", []),
    db.prepare("INSERT INTO answer_drafts VALUES (?,?,1,?,?,?) ON CONFLICT(owner_id,attempt_id) DO UPDATE SET text = excluded.text, version = version + 1, last_request_id = excluded.last_request_id").bind(context.owner.userId, attemptId, requestId, attemptId, text),
  ]);
}
export async function submitAnswer(db: D1Database, context: Command, value: AnswerInput): Promise<Receipt> {
  const input: AnswerInput = answerInput.parse(value);
  return executeAtomic(db, context, "answer.submit", input, input.attemptId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "attempts", context.owner.userId, input.attemptId, context.expectedVersion, requestId, 0, "status = 'ready'", [], "status = 'awaiting-answer'", []),
    db.prepare("INSERT INTO answers VALUES (?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.attemptId, context.expectedVersion + 1, input.text, input.submittedAt),
  ]);
}
export async function exposeHelp(db: D1Database, context: Command, value: HelpInput): Promise<Receipt> {
  const input: HelpInput = helpInput.parse(value);
  return executeAtomic(db, context, "help.expose", input, input.attemptId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "attempts", context.owner.userId, input.attemptId, context.expectedVersion, requestId, 0, "status = status", [], "status = 'awaiting-answer'", []),
    db.prepare("INSERT INTO help_events VALUES (?,?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.attemptId, context.expectedVersion + 1, input.kind, input.level, input.shownAt),
  ]);
}
export async function addFeedback(db: D1Database, context: Command, value: FeedbackInput): Promise<Receipt> {
  const input: FeedbackInput = feedbackInput.parse(value);
  return executeAtomic(db, context, "feedback.add", input, input.attemptId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "attempts", context.owner.userId, input.attemptId, context.expectedVersion, requestId, 0, "status = 'awaiting-revision'", [], "status = 'ready' AND EXISTS(SELECT 1 FROM answers WHERE owner_id = ? AND id = ? AND attempt_id = ?)", [context.owner.userId, input.answerId, input.attemptId]),
    ...input.items.map((item, index: number) => db.prepare("INSERT INTO feedback VALUES (?,?,?,?,?)").bind(context.owner.userId, item.id, input.answerId, index + 1, item.content)),
  ]);
}
export async function submitRevision(db: D1Database, context: Command, value: RevisionInput): Promise<Receipt> {
  const input: RevisionInput = revisionInput.parse(value);
  return executeAtomic(db, context, "revision.submit", input, input.attemptId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "attempts", context.owner.userId, input.attemptId, context.expectedVersion, requestId, 0, "status = status", [], "status = 'awaiting-revision' AND EXISTS(SELECT 1 FROM answers WHERE owner_id = ? AND id = ? AND attempt_id = ?)", [context.owner.userId, input.answerId, input.attemptId]),
    db.prepare("INSERT INTO revisions VALUES (?,?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.answerId, input.feedbackId, input.text, input.reason, input.submittedAt),
  ]);
}
export async function finishRevision(db: D1Database, context: Command, attemptId: string): Promise<Receipt> {
  recordId.parse(attemptId);
  return executeAtomic(db, context, "revision.finish", { attemptId }, attemptId, context.expectedVersion + 1, (requestId: string) => guardedUpdate(db, "attempts", context.owner.userId, attemptId, context.expectedVersion, requestId, 0, "status = 'ready'", [], "status = 'awaiting-revision' AND NOT EXISTS(SELECT 1 FROM feedback f JOIN answers a ON a.owner_id = f.owner_id AND a.id = f.answer_id WHERE a.owner_id = ? AND a.attempt_id = ? AND NOT EXISTS(SELECT 1 FROM revisions r WHERE r.owner_id = f.owner_id AND r.feedback_id = f.id))", [context.owner.userId, attemptId]));
}

export async function appendConversation(db: D1Database, context: Command, sessionId: string, messageId: string, role: "learner" | "coach" | "system", content: string): Promise<Receipt> {
  recordId.parse(sessionId); recordId.parse(messageId); z.enum(["learner", "coach", "system"]).parse(role); z.string().min(1).max(100_000).parse(content);
  return executeAtomic(db, context, "conversation.append", { messageId, role, content }, sessionId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "sessions", context.owner.userId, sessionId, context.expectedVersion, requestId, 0, "status = status", [], "status = 'active'", []),
    db.prepare("INSERT INTO conversations VALUES (?,?,?,?,?,?)").bind(context.owner.userId, messageId, sessionId, context.expectedVersion + 1, role, content),
  ]);
}
