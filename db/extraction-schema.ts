import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { materials, sourceReferences, uploads } from "./learning-schema.ts";

/** 한 자료의 현재 선택만 변경하며 이전 요청은 선택 버전으로 차단합니다. */
export const extractionJobs = sqliteTable("extraction_jobs", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(), uploadId: text("upload_id").notNull(), selection: text("selection").notNull(), updatedAt: integer("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }),
  foreignKey({ columns: [t.ownerId, t.id], foreignColumns: [materials.ownerId, materials.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.uploadId, t.id], foreignColumns: [uploads.ownerId, uploads.id, uploads.materialId] }).onDelete("restrict"),
  check("extraction_job_version", sql.raw("typeof(version)='integer' AND version>=1")),
  check("extraction_job_selection", sql.raw("json_valid(selection) AND json_extract(selection,'$.materialId')=id AND json_array_length(selection,'$.pages') BETWEEN 1 AND 20")),
]);

/** 처리 상태와 결과 버전은 확인 상태와 분리하고 선택별 페이지를 독립 보존합니다. */
export const extractionPages = sqliteTable("extraction_pages", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), jobId: text("job_id").notNull(), selectionRevision: integer("selection_revision").notNull(), filePage: integer("file_page").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(), resultVersion: integer("result_version").notNull(), resultId: text("result_id"), state: text("state").notNull(), printedPage: text("printed_page"), pendingAiKey: text("pending_ai_key"), pendingImage: text("pending_image"), failure: text("failure"), updatedAt: integer("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }), unique("extraction_page_scope").on(t.ownerId, t.jobId, t.selectionRevision, t.filePage),
  foreignKey({ columns: [t.ownerId, t.jobId], foreignColumns: [extractionJobs.ownerId, extractionJobs.id] }).onDelete("restrict"),
  check("extraction_page_version", sql.raw("typeof(version)='integer' AND version>=1 AND selection_revision>=1 AND file_page BETWEEN 1 AND 500 AND result_version>=0")),
  check("extraction_page_state", sql.raw("state IN ('pending','running','complete','failed','unknown')")),
  check("extraction_page_result", sql.raw("(result_version=0 AND result_id IS NULL) OR (result_version>0 AND result_id IS NOT NULL)")),
  check("extraction_page_pending", sql.raw("state NOT IN ('running','unknown') OR (pending_ai_key IS NOT NULL AND pending_image IS NOT NULL)")),
  check("extraction_page_image", sql.raw("pending_image IS NULL OR json_valid(pending_image)")),
]);

/** 결과 본문은 버전마다 새 행으로 저장하고 과거 결과를 덮어쓰지 않습니다. */
export const extractionResults = sqliteTable("extraction_results", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), pageId: text("page_id").notNull(), resultVersion: integer("result_version").notNull(), uploadId: text("upload_id").notNull(), originalVersion: text("original_version").notNull(), originalHash: text("original_hash").notNull(), result: text("result").notNull(), image: text("image"), aiCallId: text("ai_call_id"), createdAt: integer("created_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }), unique("extraction_result_version").on(t.ownerId, t.pageId, t.resultVersion),
  foreignKey({ columns: [t.ownerId, t.pageId], foreignColumns: [extractionPages.ownerId, extractionPages.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.uploadId], foreignColumns: [uploads.ownerId, uploads.id] }).onDelete("restrict"),
  check("extraction_result_payload", sql.raw("json_valid(result) AND result_version>=1 AND length(original_hash)=64")),
  check("extraction_result_image", sql.raw("image IS NULL OR json_valid(image)")),
  check("extraction_result_ai", sql.raw("json_extract(result,'$.method')!='vision' OR (ai_call_id IS NOT NULL AND image IS NOT NULL)")),
]);

/** 사용자가 확인한 정확한 결과 버전의 구간만 기록합니다. */
export const extractionConfirmations = sqliteTable("extraction_confirmations", {
  ownerId: text("owner_id").notNull(), resultId: text("result_id").notNull(), segmentId: text("segment_id").notNull(), confirmedAt: integer("confirmed_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.resultId, t.segmentId] }),
  foreignKey({ columns: [t.ownerId, t.resultId], foreignColumns: [extractionResults.ownerId, extractionResults.id] }).onDelete("restrict"),
]);

/** 출처는 확인된 구간의 불변 결과와 연결하고 현재 유효성은 조회 시 판단합니다. */
export const extractionSources = sqliteTable("extraction_sources", {
  ownerId: text("owner_id").notNull(), sourceId: text("source_id").notNull(), resultId: text("result_id").notNull(), segmentId: text("segment_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.sourceId] }), unique("extraction_source_segment").on(t.ownerId, t.resultId, t.segmentId),
  foreignKey({ columns: [t.ownerId, t.sourceId], foreignColumns: [sourceReferences.ownerId, sourceReferences.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.resultId, t.segmentId], foreignColumns: [extractionConfirmations.ownerId, extractionConfirmations.resultId, extractionConfirmations.segmentId] }).onDelete("restrict"),
]);
