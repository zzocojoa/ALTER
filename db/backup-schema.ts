import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/** 내보내기 자체의 진행 기록은 학습 스냅샷 변경으로 세지 않습니다. */
export const backupRevisions = sqliteTable("backup_revisions", {
  ownerId: text("owner_id").primaryKey(), revision: integer("revision").notNull(),
}, t => [check("backup_revision_safe", sql`${t.revision} BETWEEN 0 AND 9007199254740991`)]);

export const backupRuns = sqliteTable("backup_runs", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), sourceProjectId: text("source_project_id").notNull(),
  catalogHash: text("catalog_hash").notNull(), revision: integer("revision").notNull(), startedAt: integer("started_at").notNull(),
  state: text("state").notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), foreignKey({ columns: [t.ownerId], foreignColumns: [backupRevisions.ownerId] }),
  check("backup_run_state", sql`${t.state} IN ('exporting','database-ready','complete','cancelled')`),
  check("backup_run_values", sql`${t.revision} BETWEEN 0 AND 9007199254740991 AND ${t.startedAt} >= 0 AND length(${t.catalogHash}) = 64`)]);

export const backupPages = sqliteTable("backup_pages", {
  ownerId: text("owner_id").notNull(), backupId: text("backup_id").notNull(), tableName: text("table_name").notNull(), ordinal: integer("ordinal").notNull(),
  cursorBefore: integer("cursor_before").notNull(), cursorAfter: integer("cursor_after").notNull(), rowCount: integer("row_count").notNull(),
  bytes: integer("bytes").notNull(), sha256: text("sha256").notNull(), final: integer("final").notNull(), acknowledgedAt: integer("acknowledged_at"),
}, t => [primaryKey({ columns: [t.ownerId, t.backupId, t.tableName, t.ordinal] }),
  foreignKey({ columns: [t.ownerId, t.backupId], foreignColumns: [backupRuns.ownerId, backupRuns.id] }),
  check("backup_page_bounds", sql`${t.ordinal} BETWEEN 0 AND 9999 AND ${t.cursorBefore} >= 0 AND ${t.cursorAfter} >= ${t.cursorBefore} AND ${t.rowCount} BETWEEN 0 AND 32 AND ${t.bytes} BETWEEN 1 AND 4194304 AND length(${t.sha256}) = 64 AND ${t.final} IN (0,1)`)]);

/** 조건부 UPDATE 0건도 같은 트랜잭션에서 명시적으로 실패시킵니다. */
export const backupChecks = sqliteTable("backup_checks", {
  id: text("id").primaryKey(), matched: integer("matched").notNull(),
}, t => [check("backup_snapshot_matched", sql`${t.matched} = 1`)]);


/** 서버가 끝까지 검증한 원본과 클라이언트의 저장 확인을 구분합니다. */
export const backupObjects = sqliteTable("backup_objects", {
  ownerId: text("owner_id").notNull(), backupId: text("backup_id").notNull(), ordinal: integer("ordinal").notNull(),
  materialId: text("material_id").notNull(), uploadId: text("upload_id").notNull(), objectKey: text("object_key").notNull(),
  bytes: integer("bytes").notNull(), objectVersion: text("object_version").notNull(), etag: text("etag").notNull(), sha256: text("sha256").notNull(),
  verifiedAt: integer("verified_at").notNull(), acknowledgedAt: integer("acknowledged_at"),
}, t => [primaryKey({ columns: [t.ownerId, t.backupId, t.ordinal] }),
  unique("backup_object_upload").on(t.ownerId, t.backupId, t.uploadId), unique("backup_object_key").on(t.ownerId, t.backupId, t.objectKey),
  foreignKey({ columns: [t.ownerId, t.backupId], foreignColumns: [backupRuns.ownerId, backupRuns.id] }),
  check("backup_object_values", sql`${t.ordinal} BETWEEN 0 AND 9999 AND ${t.bytes} BETWEEN 1 AND 268435456 AND length(${t.sha256})=64 AND ${t.verifiedAt}>=0 AND (${t.acknowledgedAt} IS NULL OR ${t.acknowledgedAt}>=${t.verifiedAt})`)]);

/** 매니페스트 본문은 페이지·객체 영수증에서 재구성하고 확정 시각과 파일 해시만 보존합니다. */
export const backupCompletions = sqliteTable("backup_completions", {
  ownerId: text("owner_id").notNull(), backupId: text("backup_id").notNull(), completedAt: integer("completed_at").notNull(), sha256: text("sha256").notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.backupId] }), foreignKey({ columns: [t.ownerId, t.backupId], foreignColumns: [backupRuns.ownerId, backupRuns.id] }),
  check("backup_completion_values", sql`${t.completedAt}>=0 AND length(${t.sha256})=64`)]);
