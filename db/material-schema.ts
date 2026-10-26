import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { answers, attempts, helpEvents, materials, uploads } from "./learning-schema.ts";

/** 관측된 고아 객체 사용량은 업로드 예약 합계와 별도로 유지합니다. */
export const materialInventory = sqliteTable("material_inventory", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(),
  untrackedBytes: integer("untracked_bytes").notNull(), evidence: text("evidence").notNull(), blocked: integer("blocked").notNull(), checkedAt: integer("checked_at").notNull(), validUntil: integer("valid_until").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }), unique("material_inventory_owner").on(t.ownerId),
  check("material_inventory_version", sql.raw("typeof(version) = 'integer' AND version >= 1")),
  check("material_inventory_bytes", sql.raw("typeof(untracked_bytes) = 'integer' AND untracked_bytes BETWEEN 0 AND 268435456")),
  check("material_inventory_evidence", sql.raw("json_valid(evidence) AND blocked IN (0,1) AND valid_until > checked_at")),
]);

/** 기존 uploads 식별자를 재사용하며 R2 성공과 자료 확정을 다른 사실로 저장합니다. */
export const materialTransfers = sqliteTable("material_transfers", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), materialId: text("material_id").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(),
  metadata: text("metadata").notNull(), state: text("state").notNull(), writeStatus: text("write_status").notNull(), multipartId: text("multipart_id"), objectVersion: text("object_version"), etag: text("etag"), actualHash: text("actual_hash"), actualBytes: integer("actual_bytes"), validation: text("validation"), failureCode: text("failure_code"), updatedAt: integer("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }), unique("material_transfer_reference").on(t.ownerId, t.id, t.materialId), index("material_transfer_state").on(t.ownerId, t.state),
  foreignKey({ columns: [t.ownerId, t.id, t.materialId], foreignColumns: [uploads.ownerId, uploads.id, uploads.materialId] }).onDelete("restrict"),
  check("material_transfer_version", sql.raw("typeof(version) = 'integer' AND version >= 1")),
  check("material_transfer_metadata", sql.raw("json_valid(metadata) AND json_extract(metadata,'$.bytes') > 0")),
  check("material_transfer_state", sql.raw("state IN ('reserved','transferring','stored','validating','verified','registered','failed','unknown','cleaning','discarded')")),
  check("material_transfer_write", sql.raw("write_status IN ('not-started','active','succeeded','aborted','unknown')")),
  check("material_transfer_object", sql.raw("write_status != 'succeeded' OR (object_version IS NOT NULL AND etag IS NOT NULL AND actual_hash IS NOT NULL AND actual_bytes IS NOT NULL AND actual_hash = json_extract(metadata,'$.sha256') AND actual_bytes = json_extract(metadata,'$.bytes'))")),
  check("material_transfer_validation", sql.raw("validation IS NULL OR json_valid(validation)")),
  check("material_transfer_confirmed", sql.raw("state NOT IN ('verified','registered') OR (write_status = 'succeeded' AND validation IS NOT NULL AND json_extract(validation,'$.objectVersion') = object_version AND json_extract(validation,'$.etag') = etag AND json_extract(validation,'$.sha256') = actual_hash AND json_extract(validation,'$.bytes') = actual_bytes)")),
  check("material_transfer_cleanup", sql.raw("state NOT IN ('cleaning','discarded') OR write_status IN ('not-started','succeeded','aborted')")),
]);

export const materialFiles = sqliteTable("material_files", {
  ownerId: text("owner_id").notNull(), materialId: text("material_id").notNull(), transferId: text("transfer_id").notNull(), registeredAt: integer("registered_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.materialId] }), unique("material_file_transfer").on(t.ownerId, t.transferId),
  foreignKey({ columns: [t.ownerId, t.materialId], foreignColumns: [materials.ownerId, materials.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.transferId, t.materialId], foreignColumns: [materialTransfers.ownerId, materialTransfers.id, materialTransfers.materialId] }).onDelete("restrict"),
]);


/** 원본 열람과 학습 도움 이력을 하나의 불변 참조로 연결합니다. */
export const materialExposures = sqliteTable("material_exposures", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), materialId: text("material_id").notNull(), attemptId: text("attempt_id").notNull(), helpEventId: text("help_event_id").notNull(), shownAt: integer("shown_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }), unique("material_exposure_once").on(t.ownerId, t.attemptId, t.materialId),
  foreignKey({ columns: [t.ownerId, t.materialId], foreignColumns: [materialFiles.ownerId, materialFiles.materialId] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.attemptId], foreignColumns: [attempts.ownerId, attempts.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.helpEventId], foreignColumns: [helpEvents.ownerId, helpEvents.id] }).onDelete("restrict"),
]);

/** 사진 답안은 파일 역할과 분리된 불변 연결을 통해 같은 원본 경로를 재사용합니다. */
export const answerFiles = sqliteTable("answer_files", {
  ownerId: text("owner_id").notNull(), answerId: text("answer_id").notNull(), materialId: text("material_id").notNull(), linkedAt: integer("linked_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.answerId, t.materialId] }),
  foreignKey({ columns: [t.ownerId, t.answerId], foreignColumns: [answers.ownerId, answers.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.materialId], foreignColumns: [materialFiles.ownerId, materialFiles.materialId] }).onDelete("restrict"),
]);
