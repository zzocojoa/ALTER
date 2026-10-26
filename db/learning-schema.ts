import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const courses = sqliteTable("courses", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  title: text("title").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  check("courses_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("courses_check_1", sql.raw("length(title) > 0")),
]);

export const units = sqliteTable("units", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  courseId: text("course_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  title: text("title").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.courseId], foreignColumns: [courses.ownerId, courses.id] }).onDelete("restrict"),
  index("units_ref_0").on(t.ownerId, t.courseId),
  unique("units_unique_0").on(t.ownerId, t.courseId, t.ordinal),
  unique("units_unique_1").on(t.ownerId, t.id, t.courseId),
  check("units_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("units_check_1", sql.raw("ordinal >= 1")),
  check("units_check_2", sql.raw("length(title) > 0")),
]);

export const plans = sqliteTable("plans", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  courseId: text("course_id").notNull(),
  title: text("title").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.courseId], foreignColumns: [courses.ownerId, courses.id] }).onDelete("restrict"),
  index("plans_ref_0").on(t.ownerId, t.courseId),
  unique("plans_unique_0").on(t.ownerId, t.id, t.courseId),
  check("plans_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
]);

export const planDrafts = sqliteTable("plan_drafts", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  planId: text("plan_id").notNull(),
  content: text("content").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.planId], foreignColumns: [plans.ownerId, plans.id] }).onDelete("restrict"),
  index("plan_drafts_ref_0").on(t.ownerId, t.planId),
  unique("plan_drafts_unique_0").on(t.ownerId, t.planId),
  check("plan_drafts_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("plan_drafts_check_1", sql.raw("json_valid(content)")),
]);

export const planVersions = sqliteTable("plan_versions", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  planId: text("plan_id").notNull(),
  courseId: text("course_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  content: text("content").notNull(),
  confirmedAt: integer("confirmed_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.planId, t.courseId], foreignColumns: [plans.ownerId, plans.id, plans.courseId] }).onDelete("restrict"),
  index("plan_versions_ref_0").on(t.ownerId, t.planId, t.courseId),
  unique("plan_versions_unique_0").on(t.ownerId, t.planId, t.ordinal),
  unique("plan_versions_unique_1").on(t.ownerId, t.id, t.courseId),
  check("plan_versions_check_0", sql.raw("ordinal >= 1")),
  check("plan_versions_check_1", sql.raw("json_valid(content)")),
]);

export const materials = sqliteTable("materials", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  courseId: text("course_id").notNull(),
  title: text("title").notNull(),
  origin: text("origin").notNull(),
  originalId: text("original_id"),
  modifiedAt: text("modified_at"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.courseId], foreignColumns: [courses.ownerId, courses.id] }).onDelete("restrict"),
  index("materials_ref_0").on(t.ownerId, t.courseId),
  unique("materials_unique_0").on(t.ownerId, t.id, t.courseId),
  check("materials_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("materials_check_1", sql.raw("origin IN ('upload','google')")),
  check("materials_check_2", sql.raw("origin != 'google' OR (original_id IS NOT NULL AND modified_at IS NOT NULL)")),
]);

export const uploads = sqliteTable("uploads", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  materialId: text("material_id").notNull(),
  objectKey: text("object_key").notNull(),
  uploadId: text("upload_id").notNull(),
  state: text("state").notNull(),
  expectedHash: text("expected_hash").notNull(),
  verifiedHash: text("verified_hash"),
  bytes: integer("bytes").notNull(),
  recoveryAt: integer("recovery_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.materialId], foreignColumns: [materials.ownerId, materials.id] }).onDelete("restrict"),
  index("uploads_ref_0").on(t.ownerId, t.materialId),
  unique("uploads_unique_0").on(t.ownerId, t.objectKey),
  unique("uploads_unique_1").on(t.ownerId, t.uploadId),
  unique("uploads_unique_2").on(t.ownerId, t.id, t.materialId),
  check("uploads_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("uploads_check_1", sql.raw("state IN ('reserved','object-written','verified','unknown','missing','quarantined')")),
  check("uploads_check_2", sql.raw("state != 'verified' OR verified_hash = expected_hash")),
  check("uploads_check_3", sql.raw("bytes >= 0")),
  check("uploads_check_4", sql.raw("length(expected_hash) = 64")),
]);

export const materialPages = sqliteTable("material_pages", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  materialId: text("material_id").notNull(),
  uploadId: text("upload_id").notNull(),
  filePage: integer("file_page").notNull(),
  printedPage: text("printed_page"),
  content: text("content").notNull(),
  resultVersion: integer("result_version").notNull().default(1),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.uploadId, t.materialId], foreignColumns: [uploads.ownerId, uploads.id, uploads.materialId] }).onDelete("restrict"),
  index("material_pages_ref_0").on(t.ownerId, t.uploadId, t.materialId),
  unique("material_pages_unique_0").on(t.ownerId, t.uploadId, t.filePage, t.resultVersion),
  unique("material_pages_unique_1").on(t.ownerId, t.id, t.materialId, t.uploadId, t.filePage),
  check("material_pages_check_0", sql.raw("file_page >= 1")),
]);

export const sourceReferences = sqliteTable("source_references", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  materialId: text("material_id").notNull(),
  uploadId: text("upload_id").notNull(),
  pageId: text("page_id").notNull(),
  filePage: integer("file_page").notNull(),
  printedPage: text("printed_page"),
  spanStart: integer("span_start").notNull(),
  spanEnd: integer("span_end").notNull(),
  evidence: text("evidence").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.pageId, t.materialId, t.uploadId, t.filePage], foreignColumns: [materialPages.ownerId, materialPages.id, materialPages.materialId, materialPages.uploadId, materialPages.filePage] }).onDelete("restrict"),
  index("source_references_ref_0").on(t.ownerId, t.pageId, t.materialId, t.uploadId, t.filePage),
  check("source_references_check_0", sql.raw("span_start >= 0")),
  check("source_references_check_1", sql.raw("span_end > span_start")),
  check("source_references_check_2", sql.raw("length(evidence) > 0")),
]);

export const sessions = sqliteTable("sessions", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  courseId: text("course_id").notNull(),
  unitId: text("unit_id").notNull(),
  planVersionId: text("plan_version_id").notNull(),
  studyDate: text("study_date").notNull(),
  status: text("status").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.unitId, t.courseId], foreignColumns: [units.ownerId, units.id, units.courseId] }).onDelete("restrict"),
  index("sessions_ref_0").on(t.ownerId, t.unitId, t.courseId),
  foreignKey({ columns: [t.ownerId, t.planVersionId, t.courseId], foreignColumns: [planVersions.ownerId, planVersions.id, planVersions.courseId] }).onDelete("restrict"),
  index("sessions_ref_1").on(t.ownerId, t.planVersionId, t.courseId),
  check("sessions_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("sessions_check_1", sql.raw("status IN ('active','paused','finished')")),
  check("sessions_check_2", sql.raw("length(study_date) = 10")),
]);

export const conversations = sqliteTable("conversations", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  sessionId: text("session_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.sessionId], foreignColumns: [sessions.ownerId, sessions.id] }).onDelete("restrict"),
  index("conversations_ref_0").on(t.ownerId, t.sessionId),
  unique("conversations_unique_0").on(t.ownerId, t.sessionId, t.ordinal),
  check("conversations_check_0", sql.raw("ordinal >= 1")),
  check("conversations_check_1", sql.raw("role IN ('learner','coach','system')")),
]);

export const questions = sqliteTable("questions", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  sessionId: text("session_id").notNull(),
  sourceRefId: text("source_ref_id"),
  prompt: text("prompt").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.sessionId], foreignColumns: [sessions.ownerId, sessions.id] }).onDelete("restrict"),
  index("questions_ref_0").on(t.ownerId, t.sessionId),
  foreignKey({ columns: [t.ownerId, t.sourceRefId], foreignColumns: [sourceReferences.ownerId, sourceReferences.id] }).onDelete("restrict"),
  index("questions_ref_1").on(t.ownerId, t.sourceRefId),
  unique("questions_unique_0").on(t.ownerId, t.id, t.sessionId),
  check("questions_check_0", sql.raw("length(prompt) > 0")),
]);

export const attempts = sqliteTable("attempts", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  sessionId: text("session_id").notNull(),
  questionId: text("question_id").notNull(),
  originalQuestionId: text("original_question_id"),
  mode: text("mode").notNull(),
  hiddenMaterial: integer("hidden_material").notNull(),
  status: text("status").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.questionId, t.sessionId], foreignColumns: [questions.ownerId, questions.id, questions.sessionId] }).onDelete("restrict"),
  index("attempts_ref_0").on(t.ownerId, t.questionId, t.sessionId),
  foreignKey({ columns: [t.ownerId, t.originalQuestionId], foreignColumns: [questions.ownerId, questions.id] }).onDelete("restrict"),
  index("attempts_ref_1").on(t.ownerId, t.originalQuestionId),
  unique("attempts_unique_0").on(t.ownerId, t.id, t.sessionId),
  check("attempts_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("attempts_check_1", sql.raw("mode IN ('initial','new-condition','delayed-recall')")),
  check("attempts_check_2", sql.raw("(mode = 'new-condition') = (original_question_id IS NOT NULL)")),
  check("attempts_check_3", sql.raw("original_question_id IS NULL OR original_question_id != question_id")),
  check("attempts_check_4", sql.raw("hidden_material IN (0,1)")),
  check("attempts_check_5", sql.raw("status IN ('awaiting-answer','awaiting-revision','ready')")),
]);

export const answerDrafts = sqliteTable("answer_drafts", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  attemptId: text("attempt_id").notNull(),
  text: text("text").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.attemptId], foreignColumns: [attempts.ownerId, attempts.id] }).onDelete("restrict"),
  index("answer_drafts_ref_0").on(t.ownerId, t.attemptId),
  unique("answer_drafts_unique_0").on(t.ownerId, t.attemptId),
  check("answer_drafts_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
]);

export const answers = sqliteTable("answers", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  attemptId: text("attempt_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  submittedAt: integer("submitted_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.attemptId], foreignColumns: [attempts.ownerId, attempts.id] }).onDelete("restrict"),
  index("answers_ref_0").on(t.ownerId, t.attemptId),
  unique("answers_unique_0").on(t.ownerId, t.attemptId, t.ordinal),
  unique("answers_unique_1").on(t.ownerId, t.id, t.attemptId),
  check("answers_check_0", sql.raw("ordinal >= 1")),
  check("answers_check_1", sql.raw("length(text) > 0")),
]);

export const helpEvents = sqliteTable("help_events", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  attemptId: text("attempt_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  level: integer("level").notNull(),
  shownAt: integer("shown_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.attemptId], foreignColumns: [attempts.ownerId, attempts.id] }).onDelete("restrict"),
  index("help_events_ref_0").on(t.ownerId, t.attemptId),
  unique("help_events_unique_0").on(t.ownerId, t.attemptId, t.ordinal),
  check("help_events_check_0", sql.raw("ordinal >= 1")),
  check("help_events_check_1", sql.raw("level BETWEEN 1 AND 3")),
  check("help_events_check_2", sql.raw("kind IN ('hint','answer','explanation')")),
]);

export const feedback = sqliteTable("feedback", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  answerId: text("answer_id").notNull(),
  position: integer("position").notNull(),
  content: text("content").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.answerId], foreignColumns: [answers.ownerId, answers.id] }).onDelete("restrict"),
  index("feedback_ref_0").on(t.ownerId, t.answerId),
  unique("feedback_unique_0").on(t.ownerId, t.answerId, t.position),
  check("feedback_check_0", sql.raw("position BETWEEN 1 AND 2")),
  check("feedback_check_1", sql.raw("length(content) > 0")),
]);

export const revisions = sqliteTable("revisions", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  answerId: text("answer_id").notNull(),
  feedbackId: text("feedback_id").notNull(),
  text: text("text").notNull(),
  reason: text("reason").notNull(),
  submittedAt: integer("submitted_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.answerId], foreignColumns: [answers.ownerId, answers.id] }).onDelete("restrict"),
  index("revisions_ref_0").on(t.ownerId, t.answerId),
  foreignKey({ columns: [t.ownerId, t.feedbackId], foreignColumns: [feedback.ownerId, feedback.id] }).onDelete("restrict"),
  index("revisions_ref_1").on(t.ownerId, t.feedbackId),
  unique("revisions_unique_0").on(t.ownerId, t.feedbackId),
  check("revisions_check_0", sql.raw("length(text) > 0")),
  check("revisions_check_1", sql.raw("length(trim(reason)) > 0")),
]);

export const learningResults = sqliteTable("learning_results", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  unitId: text("unit_id").notNull(),
  currentVersionId: text("current_version_id"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.unitId], foreignColumns: [units.ownerId, units.id] }).onDelete("restrict"),
  index("learning_results_ref_0").on(t.ownerId, t.unitId),
  unique("learning_results_unique_0").on(t.ownerId, t.unitId),
  check("learning_results_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
]);

export const confirmedResults = sqliteTable("confirmed_results", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  resultId: text("result_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  answerId: text("answer_id").notNull(),
  progress: text("progress").notNull(),
  performance: text("performance").notNull(),
  confirmedAt: integer("confirmed_at").notNull(),
  correctionId: text("correction_id"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.resultId], foreignColumns: [learningResults.ownerId, learningResults.id] }).onDelete("restrict"),
  index("confirmed_results_ref_0").on(t.ownerId, t.resultId),
  foreignKey({ columns: [t.ownerId, t.answerId], foreignColumns: [answers.ownerId, answers.id] }).onDelete("restrict"),
  index("confirmed_results_ref_1").on(t.ownerId, t.answerId),
  unique("confirmed_results_unique_0").on(t.ownerId, t.resultId, t.ordinal),
  check("confirmed_results_check_0", sql.raw("ordinal >= 1")),
  check("confirmed_results_check_1", sql.raw("progress IN ('미시작','진행 중','완료')")),
  check("confirmed_results_check_2", sql.raw("performance IN ('미확인','설명 필요','도움받아 수행','독립 수행','지연 재현')")),
]);

export const errors = sqliteTable("errors", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  unitId: text("unit_id").notNull(),
  answerId: text("answer_id").notNull(),
  concept: text("concept").notNull(),
  description: text("description").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.unitId], foreignColumns: [units.ownerId, units.id] }).onDelete("restrict"),
  index("errors_ref_0").on(t.ownerId, t.unitId),
  foreignKey({ columns: [t.ownerId, t.answerId], foreignColumns: [answers.ownerId, answers.id] }).onDelete("restrict"),
  index("errors_ref_1").on(t.ownerId, t.answerId),
  check("errors_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
]);

export const reviewItems = sqliteTable("review_items", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  errorId: text("error_id").notNull(),
  sourceRefId: text("source_ref_id").notNull(),
  question: text("question").notNull(),
  explanation: text("explanation").notNull(),
  nextAction: text("next_action").notNull(),
  correctionId: text("correction_id"),
  recheckState: text("recheck_state").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.errorId], foreignColumns: [errors.ownerId, errors.id] }).onDelete("restrict"),
  index("review_items_ref_0").on(t.ownerId, t.errorId),
  foreignKey({ columns: [t.ownerId, t.sourceRefId], foreignColumns: [sourceReferences.ownerId, sourceReferences.id] }).onDelete("restrict"),
  index("review_items_ref_1").on(t.ownerId, t.sourceRefId),
  check("review_items_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("review_items_check_1", sql.raw("recheck_state IN ('required','independent','delayed')")),
]);

export const corrections = sqliteTable("corrections", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  errorId: text("error_id").notNull(),
  concept: text("concept").notNull(),
  sourceRefId: text("source_ref_id").notNull(),
  answerId: text("answer_id").notNull(),
  studyDate: text("study_date").notNull(),
  reason: text("reason").notNull(),
  evidence: text("evidence").notNull(),
  createdAt: integer("created_at"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.errorId], foreignColumns: [errors.ownerId, errors.id] }).onDelete("restrict"),
  index("corrections_ref_0").on(t.ownerId, t.errorId),
  foreignKey({ columns: [t.ownerId, t.sourceRefId], foreignColumns: [sourceReferences.ownerId, sourceReferences.id] }).onDelete("restrict"),
  index("corrections_ref_1").on(t.ownerId, t.sourceRefId),
  foreignKey({ columns: [t.ownerId, t.answerId], foreignColumns: [answers.ownerId, answers.id] }).onDelete("restrict"),
  index("corrections_ref_2").on(t.ownerId, t.answerId),
  check("corrections_check_0", sql.raw("length(trim(reason)) > 0")),
  check("corrections_check_1", sql.raw("length(trim(evidence)) > 0")),
]);

export const correctionImpacts = sqliteTable("correction_impacts", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  correctionId: text("correction_id").notNull(),
  reviewId: text("review_id").notNull(),
  oldVersion: integer("old_version").notNull(),
  newVersion: integer("new_version").notNull(),
  oldQuestion: text("old_question").notNull(),
  oldExplanation: text("old_explanation").notNull(),
  oldNextAction: text("old_next_action").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.correctionId], foreignColumns: [corrections.ownerId, corrections.id] }).onDelete("restrict"),
  index("correction_impacts_ref_0").on(t.ownerId, t.correctionId),
  foreignKey({ columns: [t.ownerId, t.reviewId], foreignColumns: [reviewItems.ownerId, reviewItems.id] }).onDelete("restrict"),
  index("correction_impacts_ref_1").on(t.ownerId, t.reviewId),
  unique("correction_impacts_unique_0").on(t.ownerId, t.correctionId, t.reviewId),
  check("correction_impacts_check_0", sql.raw("new_version = old_version + 1")),
]);

export const reviewAttempts = sqliteTable("review_attempts", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  reviewId: text("review_id").notNull(),
  correctionId: text("correction_id"),
  answerId: text("answer_id").notNull(),
  kind: text("kind").notNull(),
  performedAt: integer("performed_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.reviewId], foreignColumns: [reviewItems.ownerId, reviewItems.id] }).onDelete("restrict"),
  index("review_attempts_ref_0").on(t.ownerId, t.reviewId),
  foreignKey({ columns: [t.ownerId, t.correctionId], foreignColumns: [corrections.ownerId, corrections.id] }).onDelete("restrict"),
  index("review_attempts_ref_1").on(t.ownerId, t.correctionId),
  foreignKey({ columns: [t.ownerId, t.answerId], foreignColumns: [answers.ownerId, answers.id] }).onDelete("restrict"),
  index("review_attempts_ref_2").on(t.ownerId, t.answerId),
  check("review_attempts_check_0", sql.raw("kind IN ('variable','delayed-recall')")),
]);

export const weeklySummaries = sqliteTable("weekly_summaries", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  courseId: text("course_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.courseId], foreignColumns: [courses.ownerId, courses.id] }).onDelete("restrict"),
  index("weekly_summaries_ref_0").on(t.ownerId, t.courseId),
  unique("weekly_summaries_unique_0").on(t.ownerId, t.courseId, t.periodStart, t.periodEnd),
  check("weekly_summaries_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("weekly_summaries_check_1", sql.raw("period_start <= period_end")),
]);

export const weeklyDrafts = sqliteTable("weekly_drafts", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  summaryId: text("summary_id").notNull(),
  content: text("content").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.summaryId], foreignColumns: [weeklySummaries.ownerId, weeklySummaries.id] }).onDelete("restrict"),
  index("weekly_drafts_ref_0").on(t.ownerId, t.summaryId),
  unique("weekly_drafts_unique_0").on(t.ownerId, t.summaryId),
  check("weekly_drafts_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("weekly_drafts_check_1", sql.raw("json_valid(content)")),
]);

export const weeklyVersions = sqliteTable("weekly_versions", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  summaryId: text("summary_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  planVersionId: text("plan_version_id").notNull(),
  achievements: text("achievements").notNull(),
  difficulties: text("difficulties").notNull(),
  improvements: text("improvements").notNull(),
  nextActions: text("next_actions").notNull(),
  confirmedAt: integer("confirmed_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.summaryId], foreignColumns: [weeklySummaries.ownerId, weeklySummaries.id] }).onDelete("restrict"),
  index("weekly_versions_ref_0").on(t.ownerId, t.summaryId),
  foreignKey({ columns: [t.ownerId, t.planVersionId], foreignColumns: [planVersions.ownerId, planVersions.id] }).onDelete("restrict"),
  index("weekly_versions_ref_1").on(t.ownerId, t.planVersionId),
  unique("weekly_versions_unique_0").on(t.ownerId, t.summaryId, t.ordinal),
  check("weekly_versions_check_0", sql.raw("ordinal >= 1")),
]);

export const weeklyEvidence = sqliteTable("weekly_evidence", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  weeklyVersionId: text("weekly_version_id").notNull(),
  resultVersionId: text("result_version_id").notNull(),
  correctionId: text("correction_id"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.weeklyVersionId], foreignColumns: [weeklyVersions.ownerId, weeklyVersions.id] }).onDelete("restrict"),
  index("weekly_evidence_ref_0").on(t.ownerId, t.weeklyVersionId),
  foreignKey({ columns: [t.ownerId, t.resultVersionId], foreignColumns: [confirmedResults.ownerId, confirmedResults.id] }).onDelete("restrict"),
  index("weekly_evidence_ref_1").on(t.ownerId, t.resultVersionId),
  foreignKey({ columns: [t.ownerId, t.correctionId], foreignColumns: [corrections.ownerId, corrections.id] }).onDelete("restrict"),
  index("weekly_evidence_ref_2").on(t.ownerId, t.correctionId),
  unique("weekly_evidence_unique_0").on(t.ownerId, t.weeklyVersionId, t.resultVersionId),
]);

export const googleConnections = sqliteTable("google_connections", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  googleSubject: text("google_subject").notNull(),
  scopes: text("scopes").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
  reconnectRequired: integer("reconnect_required").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  unique("google_connections_unique_0").on(t.ownerId, t.googleSubject),
  check("google_connections_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("google_connections_check_1", sql.raw("json_valid(scopes)")),
  check("google_connections_check_2", sql.raw("reconnect_required IN (0,1)")),
]);

export const googleTokens = sqliteTable("google_tokens", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  connectionId: text("connection_id").notNull(),
  algorithm: text("algorithm").notNull(),
  ciphertext: text("ciphertext").notNull(),
  nonce: text("nonce").notNull(),
  keyVersion: text("key_version").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.connectionId], foreignColumns: [googleConnections.ownerId, googleConnections.id] }).onDelete("restrict"),
  index("google_tokens_ref_0").on(t.ownerId, t.connectionId),
  unique("google_tokens_unique_0").on(t.ownerId, t.connectionId),
  check("google_tokens_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("google_tokens_check_1", sql.raw("algorithm = 'AES-GCM'")),
  check("google_tokens_check_2", sql.raw("length(ciphertext) >= 24")),
  check("google_tokens_check_3", sql.raw("length(nonce) = 16")),
]);

export const referenceSelections = sqliteTable("reference_selections", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  connectionId: text("connection_id").notNull(),
  materialId: text("material_id").notNull(),
  externalId: text("external_id").notNull(),
  modifiedAt: text("modified_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.connectionId], foreignColumns: [googleConnections.ownerId, googleConnections.id] }).onDelete("restrict"),
  index("reference_selections_ref_0").on(t.ownerId, t.connectionId),
  foreignKey({ columns: [t.ownerId, t.materialId], foreignColumns: [materials.ownerId, materials.id] }).onDelete("restrict"),
  index("reference_selections_ref_1").on(t.ownerId, t.materialId),
  unique("reference_selections_unique_0").on(t.ownerId, t.connectionId, t.externalId),
  unique("reference_selections_unique_1").on(t.ownerId, t.materialId),
]);

export const writeTargets = sqliteTable("write_targets", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  connectionId: text("connection_id").notNull(),
  externalId: text("external_id").notNull(),
  kind: text("kind").notNull(),
  appCreated: integer("app_created").notNull(),
  approvedAt: integer("approved_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.connectionId], foreignColumns: [googleConnections.ownerId, googleConnections.id] }).onDelete("restrict"),
  index("write_targets_ref_0").on(t.ownerId, t.connectionId),
  unique("write_targets_unique_0").on(t.ownerId, t.connectionId, t.externalId, t.kind),
  check("write_targets_check_0", sql.raw("app_created IN (0,1)")),
  check("write_targets_check_1", sql.raw("kind IN ('docs','sheets','calendar')")),
  check("write_targets_check_2", sql.raw("kind != 'calendar' OR app_created = 1")),
]);

export const externalJobs = sqliteTable("external_jobs", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  weeklyVersionId: text("weekly_version_id"),
  businessKey: text("business_key").notNull(),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.weeklyVersionId], foreignColumns: [weeklyVersions.ownerId, weeklyVersions.id] }).onDelete("restrict"),
  index("external_jobs_ref_0").on(t.ownerId, t.weeklyVersionId),
  unique("external_jobs_unique_0").on(t.ownerId, t.kind, t.businessKey),
  check("external_jobs_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("external_jobs_check_1", sql.raw("kind IN ('weekly-export','calendar','ai')")),
  check("external_jobs_check_2", sql.raw("state IN ('pending','running','partial','complete','conflict')")),
]);

export const externalSteps = sqliteTable("external_steps", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  jobId: text("job_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  leaseUntil: integer("lease_until").notNull(),
  externalId: text("external_id"),
  evidence: text("evidence"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.jobId], foreignColumns: [externalJobs.ownerId, externalJobs.id] }).onDelete("restrict"),
  index("external_steps_ref_0").on(t.ownerId, t.jobId),
  unique("external_steps_unique_0").on(t.ownerId, t.jobId, t.ordinal),
  check("external_steps_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("external_steps_check_1", sql.raw("ordinal >= 1")),
  check("external_steps_check_2", sql.raw("state IN ('pending','leased','unknown','confirmed','conflict')")),
  check("external_steps_check_3", sql.raw("state != 'confirmed' OR (external_id IS NOT NULL AND evidence IS NOT NULL)")),
]);

export const externalAttempts = sqliteTable("external_attempts", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  stepId: text("step_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  outcome: text("outcome").notNull(),
  evidence: text("evidence"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.stepId], foreignColumns: [externalSteps.ownerId, externalSteps.id] }).onDelete("restrict"),
  index("external_attempts_ref_0").on(t.ownerId, t.stepId),
  unique("external_attempts_unique_0").on(t.ownerId, t.stepId, t.ordinal),
  check("external_attempts_check_0", sql.raw("ordinal >= 1")),
  check("external_attempts_check_1", sql.raw("outcome IN ('sent','unknown','confirmed','conflict','not-sent')")),
]);

export const costWindows = sqliteTable("cost_windows", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  category: text("category").notNull(),
  periodStart: integer("period_start").notNull(),
  resetAt: integer("reset_at").notNull(),
  currency: text("currency").notNull(),
  scale: integer("scale").notNull(),
  limitUnits: integer("limit_units").notNull(),
  reservedUnits: integer("reserved_units").notNull(),
  settledUnits: integer("settled_units").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  unique("cost_windows_unique_0").on(t.ownerId, t.category, t.periodStart, t.resetAt),
  check("cost_windows_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("cost_windows_check_1", sql.raw("category IN ('ai','operations')")),
  check("cost_windows_check_2", sql.raw("currency = 'KRW'")),
  check("cost_windows_check_3", sql.raw("scale = 1000000")),
  check("cost_windows_check_4", sql.raw("period_start < reset_at")),
  check("cost_windows_check_5", sql.raw("reserved_units >= 0")),
  check("cost_windows_check_6", sql.raw("settled_units >= 0")),
  check("cost_windows_check_7", sql.raw("limit_units >= 0 AND limit_units <= 9007199254740991")),
  check("cost_windows_check_8", sql.raw("reserved_units <= limit_units - settled_units")),
  check("cost_windows_check_9", sql.raw("(category = 'ai' AND limit_units <= 7000000000) OR (category = 'operations' AND limit_units <= 10000000000)")),
]);

export const costReservations = sqliteTable("cost_reservations", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  windowId: text("window_id").notNull(),
  requestBusinessKey: text("request_business_key").notNull(),
  model: text("model").notNull(),
  amountUnits: integer("amount_units").notNull(),
  state: text("state").notNull(),
  actualUnits: integer("actual_units"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.windowId], foreignColumns: [costWindows.ownerId, costWindows.id] }).onDelete("restrict"),
  index("cost_reservations_ref_0").on(t.ownerId, t.windowId),
  unique("cost_reservations_unique_0").on(t.ownerId, t.windowId, t.requestBusinessKey),
  check("cost_reservations_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("cost_reservations_check_1", sql.raw("amount_units >= 0 AND amount_units <= 9007199254740991")),
  check("cost_reservations_check_2", sql.raw("actual_units IS NULL OR (actual_units >= 0 AND actual_units <= amount_units)")),
  check("cost_reservations_check_3", sql.raw("state IN ('reserved','settled','released','unknown')")),
  check("cost_reservations_check_4", sql.raw("model = 'gpt-6-luna' OR model = 'operations'")),
]);

export const quotaWindows = sqliteTable("quota_windows", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  api: text("api").notNull(),
  projectKey: text("project_key").notNull(),
  providerUser: text("provider_user").notNull(),
  quotaUnit: text("quota_unit").notNull(),
  periodStart: integer("period_start").notNull(),
  resetAt: integer("reset_at").notNull(),
  limitUnits: integer("limit_units").notNull(),
  reservedUnits: integer("reserved_units").notNull(),
  settledUnits: integer("settled_units").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  unique("quota_windows_unique_0").on(t.ownerId, t.api, t.projectKey, t.providerUser, t.quotaUnit, t.periodStart, t.resetAt),
  check("quota_windows_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("quota_windows_check_1", sql.raw("period_start < reset_at")),
  check("quota_windows_check_2", sql.raw("limit_units BETWEEN 0 AND 9007199254740991")),
  check("quota_windows_check_3", sql.raw("reserved_units >= 0")),
  check("quota_windows_check_4", sql.raw("settled_units >= 0")),
  check("quota_windows_check_5", sql.raw("reserved_units <= limit_units - settled_units")),
]);

export const quotaReservations = sqliteTable("quota_reservations", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  version: integer("version").notNull(),
  lastRequestId: text("last_request_id").notNull(),
  windowId: text("window_id").notNull(),
  businessKey: text("business_key").notNull(),
  method: text("method").notNull(),
  weight: integer("weight").notNull(),
  state: text("state").notNull(),
  actualUnits: integer("actual_units"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.windowId], foreignColumns: [quotaWindows.ownerId, quotaWindows.id] }).onDelete("restrict"),
  index("quota_reservations_ref_0").on(t.ownerId, t.windowId),
  unique("quota_reservations_unique_0").on(t.ownerId, t.windowId, t.businessKey),
  check("quota_reservations_check_0", sql.raw("version >= 1 AND version <= 9007199254740991")),
  check("quota_reservations_check_1", sql.raw("weight > 0 AND weight <= 9007199254740991")),
  check("quota_reservations_check_2", sql.raw("actual_units IS NULL OR (actual_units >= 0 AND actual_units <= weight)")),
  check("quota_reservations_check_3", sql.raw("state IN ('reserved','settled','released','unknown')")),
]);

export const costUsage = sqliteTable("cost_usage", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  reservationId: text("reservation_id").notNull(),
  actualUnits: integer("actual_units").notNull(),
  providerReceipt: text("provider_receipt").notNull(),
  occurredAt: integer("occurred_at").notNull(),
  requestId: text("request_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.reservationId], foreignColumns: [costReservations.ownerId, costReservations.id] }).onDelete("restrict"),
  index("cost_usage_ref_0").on(t.ownerId, t.reservationId),
  unique("cost_usage_unique_0").on(t.ownerId, t.reservationId),
  check("cost_usage_check_0", sql.raw("actual_units >= 0")),
]);

export const quotaUsage = sqliteTable("quota_usage", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  reservationId: text("reservation_id").notNull(),
  actualUnits: integer("actual_units").notNull(),
  providerReceipt: text("provider_receipt").notNull(),
  occurredAt: integer("occurred_at").notNull(),
  requestId: text("request_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.reservationId], foreignColumns: [quotaReservations.ownerId, quotaReservations.id] }).onDelete("restrict"),
  index("quota_usage_ref_0").on(t.ownerId, t.reservationId),
  unique("quota_usage_unique_0").on(t.ownerId, t.reservationId),
  check("quota_usage_check_0", sql.raw("actual_units >= 0")),
]);

export const atomicRequests = sqliteTable("atomic_requests", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  scope: text("scope").notNull(),
  requestKey: text("request_key").notNull(),
  contentHash: text("content_hash").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  unique("atomic_requests_unique_0").on(t.ownerId, t.scope, t.requestKey),
  check("atomic_requests_check_0", sql.raw("length(content_hash) = 64")),
  check("atomic_requests_check_1", sql.raw("json_valid(result_json)")),
]);

export const atomicChecks = sqliteTable("atomic_checks", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  requestId: text("request_id").notNull(),
  step: integer("step").notNull(),
  matched: integer("matched").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.requestId], foreignColumns: [atomicRequests.ownerId, atomicRequests.id] }).onDelete("restrict"),
  index("atomic_checks_ref_0").on(t.ownerId, t.requestId),
  unique("atomic_checks_unique_0").on(t.ownerId, t.requestId, t.step),
  check("atomic_checks_check_0", sql.raw("matched = 1")),
]);

export const verificationRuns = sqliteTable("verification_runs", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  state: text("state").notNull(),
  createdAt: integer("created_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  check("verification_runs_check_0", sql.raw("owner_id = 'verification:' || id")),
  check("verification_runs_check_1", sql.raw("state IN ('running','cleaning')")),
]);
