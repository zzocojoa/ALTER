import { command, recordId } from "./domain/contracts.ts";
import type { Command, SiteIdentity } from "./domain/contracts.ts";
import { executeAtomic, guardedUpdate, isDomainFailure } from "../db/repositories/atomic.ts";
import type { AtomicDatabase } from "../db/repositories/atomic.ts";
import { createCourse, createPlan, createUnit, savePlanDraft, confirmPlan, listCourses } from "../db/repositories/courses.ts";
import { createMaterial, reserveUpload, recordUploadObservation, createPage, createSourceReference, uploadObjectKey, reconcileUpload } from "../db/repositories/materials.ts";
import type { UploadInput } from "../db/repositories/materials.ts";
import { createSession, pauseSession, resumeSession, createQuestion, startAttempt, saveAnswerDraft, submitAnswer, exposeHelp, addFeedback, submitRevision, finishRevision, appendConversation } from "../db/repositories/sessions.ts";
import { createLearningResult, confirmResult, latestConfirmedResult } from "../db/repositories/results.ts";
import { createError, createReview, applyCorrection, recordReviewAttempt } from "../db/repositories/reviews.ts";
import { createWeeklySummary, saveWeeklyDraft, confirmWeeklySummary, exportWeeklySummary } from "../db/repositories/weekly.ts";
import { connectGoogle, getGoogleConnection, rotateGoogleToken, revokeGoogle, selectReference, approveWriteTarget, requireReferenceAccess, requireWriteAccess } from "../db/repositories/google.ts";
import { enqueueExternalJob, claimExternalStep, markExternalUnknown, expireExternalLease, confirmExternalStep, recordExternalConflict } from "../db/repositories/external.ts";
import { createCostWindow, reserveCost, markCostUnknown, releaseCost, settleCost, seoulMonthWindow, createQuotaWindow, reserveQuota, markQuotaUnknown, releaseQuota, settleQuota } from "../db/repositories/usage.ts";

export type DataAcceptance = Readonly<{ status: "passed"; environment: "local-workerd" | "hosted-d1"; schema: "0004_evidence_boundaries"; runId: string; startedAt: string; completedAt: string; checks: readonly string[]; cleanup: "passed" }>;
const cleanupTables = ["external_attempts", "external_steps", "external_jobs", "weekly_evidence", "weekly_versions", "weekly_drafts", "weekly_summaries", "review_attempts", "correction_impacts", "review_items", "corrections", "errors", "confirmed_results", "learning_results", "revisions", "feedback", "help_events", "answer_drafts", "answers", "attempts", "questions", "conversations", "sessions", "reference_selections", "write_targets", "google_tokens", "google_connections", "source_references", "material_pages", "uploads", "materials", "plan_versions", "plan_drafts", "plans", "units", "courses", "cost_usage", "cost_reservations", "cost_windows", "quota_usage", "quota_reservations", "quota_windows", "atomic_checks", "atomic_requests", "backup_revisions"] as const;
function ensure(condition: boolean, label: string): void { if (!condition) throw new Error(`데이터 검증 실패: ${label}`); }
async function reject(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await action(); } catch (error: unknown) {
    const message: string = isDomainFailure(error) ? error.code : error instanceof Error ? error.message : String(error);
    ensure(pattern.test(message), `예상 거부 ${pattern.source}, 실제 ${message}`); return;
  }
  throw new Error(`데이터 검증 실패: 거부되어야 하는 요청 ${pattern.source}`);
}
async function cleanup(db: D1Database, runId: string, ownerId: string): Promise<void> {
  ensure(ownerId === `verification:${runId}`, "검사 데이터 범위");
  await db.prepare("UPDATE verification_runs SET state = 'cleaning' WHERE owner_id = ? AND id = ?").bind(ownerId, runId).run();
  await db.batch(cleanupTables.map((table: string): D1PreparedStatement => db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).bind(ownerId)));
  for (const table of cleanupTables) ensure(await db.prepare(`SELECT count(*) AS n FROM ${table} WHERE owner_id = ?`).bind(ownerId).first<number>("n") === 0, `정리 ${table}`);
  await db.prepare("DELETE FROM verification_runs WHERE owner_id = ? AND id = ?").bind(ownerId, runId).run();
}

/** 서버가 생성한 검사 전용 소유자 범위에서만 실행하고 실제 학습 데이터는 읽거나 변경하지 않습니다. */
export async function runDataAcceptance(db: D1Database, environment: "local-workerd" | "hosted-d1"): Promise<DataAcceptance> {
  const runId: string = crypto.randomUUID();
  const owner: SiteIdentity = { realm: "sites", userId: `verification:${runId}` };
  const startedAt: string = new Date().toISOString();
  const checks: string[] = [];
  const id = (): string => crypto.randomUUID();
  const ctx = (expectedVersion: number): Command => command.parse({ owner, requestKey: id(), expectedVersion });
  const check = (label: string): void => { checks.push(label); };
  const scalar = (sql: string, values: readonly (string | number | null)[]): Promise<number | null> => db.prepare(sql).bind(...values).first<number>("n");
  await db.prepare("INSERT INTO verification_runs VALUES (?,?,'running',?)").bind(owner.userId, runId, Date.now()).run();
  let failure: unknown = null;
  try {
    const courseId: string = id(), unitId: string = id(), planId: string = id(), planVersionId: string = id();
    const courseContext: Command = ctx(1);
    const created = await createCourse(db, courseContext, { id: recordId.parse(courseId), title: "검사 과목" });
    ensure((await createCourse(db, courseContext, { id: recordId.parse(courseId), title: "검사 과목" })).requestId === created.requestId, "멱등 재시도");
    await reject(() => createCourse(db, courseContext, { id: recordId.parse(courseId), title: "다른 내용" }), /request_key_reused/); check("same-request-replay-and-content-conflict");
    await createUnit(db, ctx(1), { id: recordId.parse(unitId), courseId: recordId.parse(courseId), ordinal: 1, title: "검사 단원" });
    await reject(() => createUnit(db, ctx(1), { id: recordId.parse(id()), courseId: recordId.parse(courseId), ordinal: 1, title: "중복 순서" }), /reference_conflict/);
    const otherOwner: Command = { ...ctx(1), owner: { realm: "sites", userId: `other:${runId}` } };
    await reject(() => createUnit(db, otherOwner, { id: recordId.parse(id()), courseId: recordId.parse(courseId), ordinal: 2, title: "다른 소유자" }), /reference_conflict/);
    ensure((await listCourses(db, otherOwner.owner)).length === 0, "소유자 목록 격리"); check("course-unit-order-owner-foreign-keys");
    await createPlan(db, ctx(1), { id: recordId.parse(planId), courseId: recordId.parse(courseId), title: "검사 계획" });
    await savePlanDraft(db, ctx(1), planId, { objective: "자료 없이 설명", unitIds: [recordId.parse(unitId)], minutesPerWeek: 120 });
    await reject(() => savePlanDraft(db, ctx(1), planId, { objective: "오래된 저장", unitIds: [recordId.parse(unitId)], minutesPerWeek: 30 }), /version_conflict/);
    await confirmPlan(db, ctx(2), planId, planVersionId, 1_792_800_000_000);
    await reject(() => db.prepare("UPDATE plan_versions SET content = '{}' WHERE owner_id = ?").bind(owner.userId).run(), /immutable/);
    await reject(() => db.prepare("DELETE FROM courses WHERE owner_id = ?").bind(owner.userId).run(), /FOREIGN KEY/); check("plan-draft-stale-version-immutable-confirmation");

    const materialId: string = id(), uploadId: string = id(), pageId: string = id(), sourceId: string = id();
    await createMaterial(db, ctx(1), { id: recordId.parse(materialId), courseId: recordId.parse(courseId), title: "검사 자료", origin: "upload", originalId: null, modifiedAt: null });
    const upload: UploadInput = { id: recordId.parse(uploadId), materialId: recordId.parse(materialId), uploadId: recordId.parse(id()), expectedHash: "a".repeat(64), bytes: 6, recoveryAt: 1_792_800_000_000 };
    await reserveUpload(db, ctx(1), upload);
    const page = { id: recordId.parse(pageId), materialId: recordId.parse(materialId), uploadId: recordId.parse(uploadId), filePage: 1, printedPage: "i", content: "근거 문장" };
    await reject(() => createPage(db, ctx(1), page), /reference_conflict/);
    ensure(reconcileUpload(upload, null).state === "missing", "메타데이터만 존재");
    await reject(async () => reconcileUpload(upload, { objectKey: "other", uploadId: upload.uploadId, hash: upload.expectedHash, bytes: 6 }), /reference_conflict/);
    ensure(reconcileUpload(upload, { objectKey: uploadObjectKey(upload), uploadId: upload.uploadId, hash: "b".repeat(64), bytes: 6 }).state === "quarantined", "다른 객체 보존");
    await recordUploadObservation(db, ctx(1), upload, { objectKey: uploadObjectKey(upload), uploadId: upload.uploadId, hash: upload.expectedHash, bytes: 6 });
    await createPage(db, ctx(1), page);
    const source = { id: recordId.parse(sourceId), materialId: recordId.parse(materialId), uploadId: recordId.parse(uploadId), pageId: recordId.parse(pageId), filePage: 1, printedPage: "i", spanStart: 0, spanEnd: 2, evidence: "근거" };
    await createSourceReference(db, ctx(1), source);
    await reject(() => createSourceReference(db, ctx(1), { ...source, id: recordId.parse(id()), pageId: recordId.parse(id()) }), /reference_conflict/);
    await reject(() => createSourceReference(db, ctx(1), { ...source, id: recordId.parse(id()), materialId: recordId.parse(id()) }), /reference_conflict/);
    await reject(() => createSourceReference(db, ctx(1), { ...source, id: recordId.parse(id()), spanEnd: 99 }), /reference_conflict/); check("upload-reconciliation-and-exact-source-integrity");

    const sessionId: string = id(), questionId: string = id(), attemptId: string = id(), answerId: string = id();
    const when: number = Date.parse("2026-10-24T01:00:00Z");
    await createSession(db, ctx(1), { id: recordId.parse(sessionId), courseId: recordId.parse(courseId), unitId: recordId.parse(unitId), planVersionId: recordId.parse(planVersionId), studyDate: "2026-10-24" });
    await pauseSession(db, ctx(1), sessionId); await resumeSession(db, ctx(2), sessionId);
    await appendConversation(db, ctx(3), sessionId, id(), "learner", "검사 대화");
    await createQuestion(db, ctx(1), { id: recordId.parse(questionId), sessionId: recordId.parse(sessionId), sourceRefId: recordId.parse(sourceId), prompt: "핵심 설명" });
    await startAttempt(db, ctx(1), { id: recordId.parse(attemptId), sessionId: recordId.parse(sessionId), questionId: recordId.parse(questionId), originalQuestionId: null, mode: "initial", hiddenMaterial: true });
    await saveAnswerDraft(db, ctx(1), attemptId, "초안");
    await reject(() => saveAnswerDraft(db, ctx(1), attemptId, "낡은 초안"), /version_conflict/);
    await exposeHelp(db, ctx(2), { id: recordId.parse(id()), attemptId: recordId.parse(attemptId), kind: "hint", level: 1, shownAt: when - 1 });
    await submitAnswer(db, ctx(3), { id: recordId.parse(answerId), attemptId: recordId.parse(attemptId), text: "도움받은 답", submittedAt: when });
    await reject(() => submitAnswer(db, ctx(4), { id: recordId.parse(id()), attemptId: recordId.parse(attemptId), text: "중복 답", submittedAt: when }), /version_conflict/);
    await reject(() => db.prepare("DELETE FROM help_events WHERE owner_id = ?").bind(owner.userId).run(), /immutable/);
    await reject(() => db.prepare("UPDATE help_events SET level = 2 WHERE owner_id = ?").bind(owner.userId).run(), /immutable/);
    const feedbackId: string = id();
    await addFeedback(db, ctx(4), { attemptId: recordId.parse(attemptId), answerId: recordId.parse(answerId), items: [{ id: recordId.parse(feedbackId), content: "근거 연결" }] });
    await reject(() => finishRevision(db, ctx(5), attemptId), /version_conflict/);
    await reject(() => submitRevision(db, ctx(5), { id: recordId.parse(id()), attemptId: recordId.parse(attemptId), answerId: recordId.parse(answerId), feedbackId: recordId.parse(feedbackId), text: "수정", reason: "", submittedAt: when }), /too_small|최소|string/i);
    await submitRevision(db, ctx(5), { id: recordId.parse(id()), attemptId: recordId.parse(attemptId), answerId: recordId.parse(answerId), feedbackId: recordId.parse(feedbackId), text: "수정 답", reason: "자료 근거 반영", submittedAt: when });
    await finishRevision(db, ctx(6), attemptId); check("session-resume-draft-help-append-only-editor-revision");

    const resultId: string = id(), assistedId: string = id();
    await createLearningResult(db, ctx(1), resultId, unitId);
    await reject(() => confirmResult(db, ctx(1), { id: recordId.parse(id()), resultId: recordId.parse(resultId), answerId: recordId.parse(answerId), progress: "완료", performance: "독립 수행", confirmedAt: when, correctionId: null }), /reference_conflict/);
    await confirmResult(db, ctx(1), { id: recordId.parse(assistedId), resultId: recordId.parse(resultId), answerId: recordId.parse(answerId), progress: "완료", performance: "도움받아 수행", confirmedAt: when, correctionId: null });
    ensure((await latestConfirmedResult(db, owner, unitId))?.performance === "도움받아 수행", "진도 완료와 수행 분리");
    const newQuestionId: string = id(), independentAttempt: string = id(), independentAnswer: string = id();
    await createQuestion(db, ctx(1), { id: recordId.parse(newQuestionId), sessionId: recordId.parse(sessionId), sourceRefId: recordId.parse(sourceId), prompt: "새 조건 변형" });
    await startAttempt(db, ctx(1), { id: recordId.parse(independentAttempt), sessionId: recordId.parse(sessionId), questionId: recordId.parse(newQuestionId), originalQuestionId: recordId.parse(questionId), mode: "new-condition", hiddenMaterial: true });
    await submitAnswer(db, ctx(1), { id: recordId.parse(independentAnswer), attemptId: recordId.parse(independentAttempt), text: "새 조건 독립 설명", submittedAt: when + 1000 });
    const concurrentConfirm = await Promise.allSettled([0, 1].map(() => confirmResult(db, ctx(2), { id: recordId.parse(id()), resultId: recordId.parse(resultId), answerId: recordId.parse(independentAnswer), progress: "완료", performance: "독립 수행", confirmedAt: when + 1000, correctionId: null })));
    ensure(concurrentConfirm.filter((result) => result.status === "fulfilled").length === 1, "동시 확정 1건");
    ensure((await latestConfirmedResult(db, owner, unitId))?.performance === "독립 수행", "최신 확정 조회"); check("confirmation-concurrency-and-independent-evidence");

    const errorId: string = id(), reviewId: string = id(), secondReview: string = id(), correctionId: string = id();
    await createError(db, ctx(1), { id: recordId.parse(errorId), unitId: recordId.parse(unitId), answerId: recordId.parse(answerId), concept: "근거", description: "설명 누락" });
    for (const review of [reviewId, secondReview]) await createReview(db, ctx(1), { id: recordId.parse(review), errorId: recordId.parse(errorId), sourceRefId: recordId.parse(sourceId), question: "이전 질문", explanation: "이전 설명", nextAction: "이전 행동" });
    const correction = { id: recordId.parse(correctionId), errorId: recordId.parse(errorId), concept: "근거", sourceRefId: recordId.parse(sourceId), answerId: recordId.parse(answerId), studyDate: "2026-10-24", createdAt: when + 1500, reason: "자료 재확인", evidence: "근거", targets: [reviewId, secondReview].map((review) => ({ reviewId: recordId.parse(review), expectedVersion: 1, question: "정정 질문", explanation: "정정 설명", nextAction: "새 조건 재검증" })) };
    await reject(() => applyCorrection(db, ctx(1), { ...correction, targets: correction.targets.slice(0, 1) }), /version_conflict/);
    await reject(() => applyCorrection(db, ctx(1), { ...correction, targets: [correction.targets[0], { ...correction.targets[1], expectedVersion: 9 }] }), /version_conflict/);
    ensure(await scalar("SELECT count(*) AS n FROM corrections WHERE owner_id = ?", [owner.userId]) === 0, "중간 정정 실패 롤백");
    const correctionRace = await Promise.allSettled([0, 1].map(() => applyCorrection(db, ctx(1), correction)));
    ensure(correctionRace.filter((result) => result.status === "fulfilled").length === 1, "동시 정정 1건");
    ensure(await scalar("SELECT count(*) AS n FROM review_items WHERE owner_id = ? AND correction_id = ? AND recheck_state = 'required'", [owner.userId, correctionId]) === 2, "정정 전파");
    await reject(() => confirmResult(db, ctx(3), { id: recordId.parse(id()), resultId: recordId.parse(resultId), answerId: recordId.parse(independentAnswer), progress: "완료", performance: "독립 수행", confirmedAt: when + 2000, correctionId: recordId.parse(correctionId) }), /reference_conflict/);
    await reject(() => recordReviewAttempt(db, ctx(2), { id: recordId.parse(id()), reviewId: recordId.parse(reviewId), correctionId: recordId.parse(correctionId), answerId: recordId.parse(independentAnswer), kind: "variable", performedAt: when + 2000 }), /reference_conflict/);
    const recheckQuestion: string = id(), recheckAttempt: string = id(), recheckAnswer: string = id();
    await createQuestion(db, ctx(1), { id: recordId.parse(recheckQuestion), sessionId: recordId.parse(sessionId), sourceRefId: recordId.parse(sourceId), prompt: "정정 후 새 조건" });
    await startAttempt(db, ctx(1), { id: recordId.parse(recheckAttempt), sessionId: recordId.parse(sessionId), questionId: recordId.parse(recheckQuestion), originalQuestionId: recordId.parse(questionId), mode: "new-condition", hiddenMaterial: true });
    await submitAnswer(db, ctx(1), { id: recordId.parse(recheckAnswer), attemptId: recordId.parse(recheckAttempt), text: "정정 후 재검증", submittedAt: when + 2000 });
    for (const review of [reviewId, secondReview]) await recordReviewAttempt(db, ctx(2), { id: recordId.parse(id()), reviewId: recordId.parse(review), correctionId: recordId.parse(correctionId), answerId: recordId.parse(recheckAnswer), kind: "variable", performedAt: when + 2000 });
    const correctedResult: string = id();
    await confirmResult(db, ctx(3), { id: recordId.parse(correctedResult), resultId: recordId.parse(resultId), answerId: recordId.parse(recheckAnswer), progress: "완료", performance: "독립 수행", confirmedAt: when + 2000, correctionId: recordId.parse(correctionId) });
    check("correction-all-targets-concurrency-rollback-recheck");

    const delayedQuestion: string = id(), delayedAttempt: string = id(), delayedAnswer: string = id();
    const tomorrow: number = when + 86_400_000;
    await createQuestion(db, ctx(1), { id: recordId.parse(delayedQuestion), sessionId: recordId.parse(sessionId), sourceRefId: recordId.parse(sourceId), prompt: "다음날 인출" });
    await startAttempt(db, ctx(1), { id: recordId.parse(delayedAttempt), sessionId: recordId.parse(sessionId), questionId: recordId.parse(delayedQuestion), originalQuestionId: null, mode: "delayed-recall", hiddenMaterial: true });
    await submitAnswer(db, ctx(1), { id: recordId.parse(delayedAnswer), attemptId: recordId.parse(delayedAttempt), text: "지연 인출", submittedAt: tomorrow });
    for (const review of [reviewId, secondReview]) await recordReviewAttempt(db, ctx(3), { id: recordId.parse(id()), reviewId: recordId.parse(review), correctionId: recordId.parse(correctionId), answerId: recordId.parse(delayedAnswer), kind: "delayed-recall", performedAt: tomorrow });
    await confirmResult(db, ctx(4), { id: recordId.parse(id()), resultId: recordId.parse(resultId), answerId: recordId.parse(delayedAnswer), progress: "완료", performance: "지연 재현", confirmedAt: tomorrow, correctionId: recordId.parse(correctionId) });
    ensure((await latestConfirmedResult(db, owner, unitId))?.performance === "지연 재현", "지연 재현 증거"); check("delayed-recall-separate-evidence");

    const weeklyId: string = id(), weeklyVersion: string = id();
    const weekly = { achievements: "변형 과제 독립 수행", difficulties: "설명 누락", improvements: "근거 확인", nextActions: "지연 복습" };
    await createWeeklySummary(db, ctx(1), { id: recordId.parse(weeklyId), courseId: recordId.parse(courseId), periodStart: "2026-10-19", periodEnd: "2026-10-25" });
    await reject(() => createWeeklySummary(db, ctx(1), { id: recordId.parse(id()), courseId: recordId.parse(courseId), periodStart: "2026-10-19", periodEnd: "2026-10-25" }), /reference_conflict/);
    await saveWeeklyDraft(db, ctx(1), weeklyId, weekly);
    await reject(() => exportWeeklySummary(db, owner, weeklyId), /reference_conflict/);
    await confirmWeeklySummary(db, ctx(2), { id: recordId.parse(weeklyVersion), summaryId: recordId.parse(weeklyId), planVersionId: recordId.parse(planVersionId), confirmedAt: tomorrow, evidence: [{ resultVersionId: recordId.parse(correctedResult), correctionId: recordId.parse(correctionId) }] });
    await saveWeeklyDraft(db, ctx(3), weeklyId, { ...weekly, nextActions: "다른 초안" });
    ensure((await exportWeeklySummary(db, owner, weeklyVersion)).nextActions === "지연 복습", "확정 요약 보존"); check("weekly-confirmed-version-export-and-draft-isolation");

    const connectionId: string = id(), googleMaterial: string = id();
    const token = { algorithm: "AES-GCM" as const, ciphertext: "C".repeat(32), nonce: "N".repeat(16), keyVersion: "verification-only-v1" };
    await connectGoogle(db, ctx(1), { id: recordId.parse(connectionId), google: { realm: "google", subject: `google-different-${runId}` }, scopes: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/calendar.app.created"], expiresAt: tomorrow, token });
    const connection = await getGoogleConnection(db, owner, connectionId);
    ensure(!JSON.stringify(connection).includes("ciphertext") && !JSON.stringify(connection).includes(token.ciphertext), "일반 조회 토큰 제외");
    await createMaterial(db, ctx(1), { id: recordId.parse(googleMaterial), courseId: recordId.parse(courseId), title: "선택 문서", origin: "google", originalId: "selected-doc", modifiedAt: "v1" });
    await selectReference(db, ctx(1), { id: recordId.parse(id()), connectionId: recordId.parse(connectionId), materialId: recordId.parse(googleMaterial), externalId: "selected-doc", modifiedAt: "v1" });
    await requireReferenceAccess(db, owner, connectionId, "selected-doc", when);
    await reject(() => requireReferenceAccess(db, owner, connectionId, "unselected-doc", when), /reference_conflict/);
    await reject(() => requireWriteAccess(db, owner, connectionId, "selected-doc", "docs", when), /reference_conflict/);
    await approveWriteTarget(db, ctx(1), { id: recordId.parse(id()), connectionId: recordId.parse(connectionId), externalId: "app-calendar", kind: "calendar", appCreated: true, approvedAt: when });
    await requireWriteAccess(db, owner, connectionId, "app-calendar", "calendar", when);
    await reject(() => requireWriteAccess(db, owner, connectionId, "other-calendar", "calendar", when), /reference_conflict/);
    await reject(() => requireReferenceAccess(db, owner, connectionId, "selected-doc", tomorrow), /reference_conflict/);
    const rotations = await Promise.allSettled([0, 1].map(() => rotateGoogleToken(db, ctx(1), connectionId, 1, { ...token, nonce: "M".repeat(16) }, tomorrow + 1)));
    ensure(rotations.filter((result) => result.status === "fulfilled").length === 1, "동시 토큰 교체");
    await revokeGoogle(db, ctx(2), connectionId, when);
    await reject(() => requireReferenceAccess(db, owner, connectionId, "selected-doc", when), /reference_conflict/); check("google-identity-scope-selection-token-rotation-revocation");

    const jobId: string = id(), firstStep: string = id(), secondStep: string = id();
    await enqueueExternalJob(db, ctx(1), { id: recordId.parse(jobId), weeklyVersionId: recordId.parse(weeklyVersion), businessKey: "weekly-v1", kind: "weekly-export", steps: [{ id: recordId.parse(firstStep), kind: "docs.create" }, { id: recordId.parse(secondStep), kind: "docs.body" }] });
    const claims = await Promise.allSettled([0, 1].map(() => claimExternalStep(db, ctx(1), { stepId: recordId.parse(firstStep), attemptId: recordId.parse(id()), ordinal: 1, now: when, leaseUntil: when + 10 })));
    ensure(claims.filter((result) => result.status === "fulfilled").length === 1, "외부 작업 단일 임대");
    await reject(() => claimExternalStep(db, ctx(1), { stepId: recordId.parse(secondStep), attemptId: recordId.parse(id()), ordinal: 1, now: when, leaseUntil: when + 10 }), /version_conflict/);
    await expireExternalLease(db, ctx(2), firstStep, when + 11);
    await reject(() => claimExternalStep(db, ctx(3), { stepId: recordId.parse(firstStep), attemptId: recordId.parse(id()), ordinal: 2, now: when + 20, leaseUntil: when + 30 }), /version_conflict/);
    await confirmExternalStep(db, ctx(3), { stepId: recordId.parse(firstStep), externalId: "created-doc", businessKey: "weekly-v1", evidence: "provider document ID observed", checkedAt: when + 30 });
    await claimExternalStep(db, ctx(1), { stepId: recordId.parse(secondStep), attemptId: recordId.parse(id()), ordinal: 1, now: when + 40, leaseUntil: when + 50 });
    await markExternalUnknown(db, ctx(2), secondStep, "response-lost");
    await recordExternalConflict(db, ctx(3), secondStep, "사용자가 문서를 수정함");
    await reject(() => claimExternalStep(db, ctx(4), { stepId: recordId.parse(secondStep), attemptId: recordId.parse(id()), ordinal: 2, now: tomorrow, leaseUntil: tomorrow + 10 }), /version_conflict/); ensure(await db.prepare("SELECT state FROM external_jobs WHERE owner_id = ? AND id = ?").bind(owner.userId, jobId).first<string>("state") === "conflict", "상위 작업 충돌 반영");
    ensure(await scalar("SELECT count(*) AS n FROM external_attempts WHERE owner_id = ? AND outcome = 'confirmed'", [owner.userId]) === 1, "외부 시도 확정 증거"); check("external-lease-unknown-partial-success-user-conflict");

    const costWindow: string = id(), reservationId: string = id();
    await createCostWindow(db, ctx(1), { id: recordId.parse(costWindow), category: "ai", ...seoulMonthWindow(when) });
    await reserveCost(db, ctx(1), { id: recordId.parse(reservationId), windowId: recordId.parse(costWindow), businessKey: "ai-call", model: "gpt-6-luna", amountUnits: 6_000_000_000, now: when });
    await reject(() => reserveCost(db, ctx(2), { id: recordId.parse(id()), windowId: recordId.parse(costWindow), businessKey: "over-limit", model: "gpt-6-luna", amountUnits: 2_000_000_000, now: when }), /limit_exceeded/);
    await markCostUnknown(db, ctx(1), reservationId);
    await reject(() => releaseCost(db, ctx(2), reservationId, costWindow, 2), /version_conflict/);
    await settleCost(db, ctx(2), { reservationId: recordId.parse(reservationId), windowId: recordId.parse(costWindow), windowVersion: 2, actualUnits: 5_000_000_000, providerReceipt: "provider-cost-proof", occurredAt: when });
    await reject(() => settleCost(db, ctx(3), { reservationId: recordId.parse(reservationId), windowId: recordId.parse(costWindow), windowVersion: 3, actualUnits: 1, providerReceipt: "duplicate", occurredAt: when }), /version_conflict/);
    const costRace = await Promise.allSettled([0, 1].map((index) => reserveCost(db, ctx(3), { id: recordId.parse(id()), windowId: recordId.parse(costWindow), businessKey: `race-${index}`, model: "gpt-6-luna", amountUnits: 2_000_000_000, now: when })));
    ensure(costRace.filter((result) => result.status === "fulfilled").length === 1, "비용 동시 예약 상한"); check("exact-cost-limits-concurrency-unknown-and-single-settlement");
    const quotaWindow: string = id(), quotaId: string = id();
    await createQuotaWindow(db, ctx(1), { id: recordId.parse(quotaWindow), api: "google-docs", projectKey: "verification-project", providerUser: "google-subject", quotaUnit: "weighted-requests", periodStart: when, resetAt: when + 60_000, limitUnits: 10 });
    await reserveQuota(db, ctx(1), { id: recordId.parse(quotaId), windowId: recordId.parse(quotaWindow), businessKey: "write-and-verify", method: "batchUpdate+get", weight: 7, now: when });
    await reject(() => reserveQuota(db, ctx(2), { id: recordId.parse(id()), windowId: recordId.parse(quotaWindow), businessKey: "excess", method: "retry", weight: 4, now: when }), /limit_exceeded/);
    await reject(() => reserveQuota(db, ctx(2), { id: recordId.parse(id()), windowId: recordId.parse(quotaWindow), businessKey: "expired", method: "get", weight: 1, now: when + 60_000 }), /version_conflict/);
    await markQuotaUnknown(db, ctx(1), quotaId);
    await reject(() => releaseQuota(db, ctx(2), quotaId, quotaWindow, 2), /version_conflict/);
    await settleQuota(db, ctx(2), { reservationId: recordId.parse(quotaId), windowId: recordId.parse(quotaWindow), windowVersion: 2, actualUnits: 6, providerReceipt: "weighted-usage-proof", occurredAt: when + 1 }); check("quota-method-weights-provider-window-unknown-reservation");

    const unsafeId: string = id();
    await db.batch([db.prepare("UPDATE courses SET title = '잘못된 갱신' WHERE owner_id = ? AND id = ?").bind(owner.userId, id()), db.prepare("INSERT INTO courses VALUES (?,?,1,'unguarded','0행 뒤 저장')").bind(owner.userId, unsafeId)]);
    ensure(await scalar("SELECT count(*) AS n FROM courses WHERE owner_id = ? AND id = ?", [owner.userId, unsafeId]) === 1, "무방비 0행 재현");
    for (const expected of [99, 1]) {
      const target: string = expected === 99 ? courseId : id();
      const request: Command = ctx(expected);
      await reject(() => executeAtomic(db, request, "acceptance.guard", { expected }, target, expected + 1, (requestId: string) => [...guardedUpdate(db, "courses", owner.userId, target, expected, requestId, 0, "title = '불완전 저장'", [], "1", []), db.prepare("INSERT INTO courses VALUES (?,?,1,'should-rollback','금지')").bind(owner.userId, id())]), /version_conflict/);
      ensure(await scalar("SELECT count(*) AS n FROM atomic_requests WHERE owner_id = ? AND request_key = ?", [owner.userId, request.requestKey]) === 0, "실패 요청 행 롤백");
    }
    for (const position of [0, 1, 2]) {
      const request: Command = ctx(1);
      await reject(() => executeAtomic(db, request, "acceptance.failure", { position }, courseId, 2, (requestId: string) => {
        const normal: D1PreparedStatement[] = [...guardedUpdate(db, "courses", owner.userId, courseId, 1, requestId, 0, "title = '롤백 대상'", [], "1", [])];
        const bad: D1PreparedStatement = db.prepare("INSERT INTO atomic_checks VALUES (?,?,?,?,0)").bind(owner.userId, id(), requestId, 99);
        return [...normal.slice(0, position), bad, ...normal.slice(position)];
      }), /version_conflict/);
      ensure(await scalar("SELECT version AS n FROM courses WHERE owner_id = ? AND id = ?", [owner.userId, courseId]) === 1, "앞 중간 끝 실패 전체 롤백");
    }
    check("real-d1-unguarded-zero-row-reproduction-and-full-batch-rollback");
    const recoveredId: string = id(), uncertainContext: Command = ctx(1);
    const lostResponseDb: AtomicDatabase = {
      prepare: (query: string): D1PreparedStatement => db.prepare(query),
      batch: async (statements: D1PreparedStatement[]): Promise<never> => { await db.batch(statements); throw new Error("network response lost after commit"); },
    };
    const recovered = await executeAtomic(lostResponseDb, uncertainContext, "acceptance.lost-response", { title: "응답 유실" }, recoveredId, 1, (requestId: string) => [db.prepare("INSERT INTO courses VALUES (?,?,1,?,'응답 유실')").bind(owner.userId, recoveredId, requestId)]);
    ensure(await scalar("SELECT count(*) AS n FROM atomic_requests WHERE owner_id = ? AND id = ?", [owner.userId, recovered.requestId]) === 1, "응답 유실 후 커밋 재확인");
    const duplicateId: string = id(), duplicateContext: Command = ctx(1);
    const duplicates = await Promise.all([0, 1].map(() => createCourse(db, duplicateContext, { id: recordId.parse(duplicateId), title: "동시 중복 요청" })));
    ensure(duplicates[0].requestId === duplicates[1].requestId, "동시 동일 키는 같은 결과"); check("lost-commit-response-and-concurrent-idempotent-replay");
    const quotaRace = await Promise.allSettled([0, 1].map((index) => reserveQuota(db, ctx(3), { id: recordId.parse(id()), windowId: recordId.parse(quotaWindow), businessKey: `weighted-race-${index}`, method: "verify-read", weight: 4, now: when + 10 })));
    ensure(quotaRace.filter((result) => result.status === "fulfilled").length === 1, "가중 사용량 동시 예약 상한");
    await reject(() => db.prepare("UPDATE cost_windows SET reserved_units = 0.5 WHERE owner_id = ? AND id = ?").bind(owner.userId, costWindow).run(), /invalid_integer/); check("weighted-quota-concurrency-and-database-integer-enforcement");
    ensure((await db.prepare("PRAGMA foreign_key_check").all()).results.length === 0, "외래 키 전체 무결성"); check("foreign-key-check");
  } catch (error: unknown) { failure = error; }
  try { await cleanup(db, runId, owner.userId); }
  catch (cleanupError: unknown) { throw failure === null ? cleanupError : new AggregateError([failure, cleanupError], "검증 및 정리가 모두 실패했습니다."); }
  if (failure !== null) throw failure;
  return { status: "passed", environment, schema: "0004_evidence_boundaries", runId, startedAt, completedAt: new Date().toISOString(), checks, cleanup: "passed" };
}
