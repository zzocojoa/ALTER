import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { materials, planVersions, sourceReferences, units } from "./learning-schema.ts";

/** 자료 연결은 판본·계획·단원별로 보존하고 재선택은 새 연결을 만듭니다. */
export const librarianLinks = sqliteTable("librarian_links", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), planVersionId: text("plan_version_id").notNull(), unitId: text("unit_id").notNull(), materialId: text("material_id").notNull(), content: text("content").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] }), foreignKey({ columns: [t.ownerId, t.planVersionId], foreignColumns: [planVersions.ownerId, planVersions.id] }), foreignKey({ columns: [t.ownerId, t.unitId], foreignColumns: [units.ownerId, units.id] }), foreignKey({ columns: [t.ownerId, t.materialId], foreignColumns: [materials.ownerId, materials.id] }), check("librarian_link_content", sql.raw("json_valid(content) AND json_extract(content,'$.id')=id AND json_extract(content,'$.planVersionId')=plan_version_id AND json_extract(content,'$.unitId')=unit_id AND json_extract(content,'$.materialId')=material_id"))]);
export const librarianLinkSources = sqliteTable("librarian_link_sources", {
  ownerId: text("owner_id").notNull(), linkId: text("link_id").notNull(), sourceId: text("source_id").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.linkId, t.sourceId] }), foreignKey({ columns: [t.ownerId, t.linkId], foreignColumns: [librarianLinks.ownerId, librarianLinks.id] }), foreignKey({ columns: [t.ownerId, t.sourceId], foreignColumns: [sourceReferences.ownerId, sourceReferences.id] })]);
export const studyScopes = sqliteTable("study_scopes", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(), planVersionId: text("plan_version_id").notNull(), unitId: text("unit_id").notNull(), state: text("state").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] }), foreignKey({ columns: [t.ownerId, t.planVersionId], foreignColumns: [planVersions.ownerId, planVersions.id] }), foreignKey({ columns: [t.ownerId, t.unitId], foreignColumns: [units.ownerId, units.id] }), check("study_scope_state", sql.raw("json_valid(state) AND version>=1 AND json_extract(state,'$.version')=version AND json_extract(state,'$.input.id')=id AND json_extract(state,'$.input.planVersionId')=plan_version_id AND json_extract(state,'$.input.unitId')=unit_id"))]);
/** 제안·확정 이전의 선택과 근거를 불변 사건으로 보관합니다. */
export const scopeEvents = sqliteTable("scope_events", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), scopeId: text("scope_id").notNull(), version: integer("version").notNull(), content: text("content").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] }), unique("scope_event_version").on(t.ownerId, t.scopeId, t.version), foreignKey({ columns: [t.ownerId, t.scopeId], foreignColumns: [studyScopes.ownerId, studyScopes.id] }), check("scope_event_content", sql.raw("json_valid(content) AND version>=1"))]);
