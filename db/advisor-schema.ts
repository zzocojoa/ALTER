import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const advisorSessions = sqliteTable("advisor_sessions", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(), state: text("state").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] }), check("advisor_state_valid", sql.raw("json_valid(state) AND json_extract(state,'$.id')=id AND json_extract(state,'$.version')=version AND version>=1"))]);

/** 답변·노출·AI 추정·계획 확정의 원본 사건을 수정하지 않고 보존합니다. */
export const advisorEvents = sqliteTable("advisor_events", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), sessionId: text("session_id").notNull(), version: integer("version").notNull(), kind: text("kind").notNull(), content: text("content").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] }), unique("advisor_event_version").on(t.ownerId, t.sessionId, t.version), foreignKey({ columns: [t.ownerId, t.sessionId], foreignColumns: [advisorSessions.ownerId, advisorSessions.id] }).onDelete("restrict"), check("advisor_event_valid", sql.raw("json_valid(content) AND version>=1 AND kind IN ('start','answer','begin','turn','plan','edit','confirm')"))]);
