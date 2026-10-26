import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { costReservations, externalAttempts, externalJobs, externalSteps } from "./learning-schema.ts";

export const aiPricingVersions = sqliteTable("ai_pricing_versions", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), fingerprint: text("fingerprint").notNull(), snapshot: text("snapshot").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] }), check("ai_pricing_snapshot", sql.raw("json_valid(snapshot) AND json_extract(snapshot,'$.id') = id AND json_extract(snapshot,'$.model') = 'gpt-6-luna'"))]);

export const aiCostIntents = sqliteTable("ai_cost_intents", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), scope: text("scope").notNull(), requestKey: text("request_key").notNull(), requestFingerprint: text("request_fingerprint").notNull(), pricingVersionId: text("pricing_version_id").notNull(), bound: text("bound").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }), unique("ai_cost_intent_key").on(t.ownerId, t.scope, t.requestKey),
  foreignKey({ columns: [t.ownerId, t.id], foreignColumns: [costReservations.ownerId, costReservations.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.pricingVersionId], foreignColumns: [aiPricingVersions.ownerId, aiPricingVersions.id] }).onDelete("restrict"),
  check("ai_cost_bound", sql.raw("json_valid(bound) AND json_extract(bound,'$.requestFingerprint') = request_fingerprint AND json_extract(bound,'$.amount.pricingVersionId') = pricing_version_id")),
]);

export const aiBudgetBlocks = sqliteTable("ai_budget_blocks", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), reservationId: text("reservation_id").notNull(), reason: text("reason").notNull(), actualUnits: integer("actual_units").notNull(), createdAt: integer("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.id] }), unique("ai_block_reservation").on(t.ownerId, t.reservationId), foreignKey({ columns: [t.ownerId, t.reservationId], foreignColumns: [costReservations.ownerId, costReservations.id] }).onDelete("restrict"), check("ai_block_actual", sql.raw("typeof(actual_units) = 'integer' AND actual_units >= 0 AND actual_units <= 9007199254740991"))]);

export const aiCalls = sqliteTable("ai_calls", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(),
  stepId: text("step_id").notNull(), logicalRequestKey: text("logical_request_key").notNull(), attemptOrdinal: integer("attempt_ordinal").notNull(), stage: text("stage").notNull(),
  responseId: text("response_id"), providerRequestId: text("provider_request_id"), usage: text("usage"), result: text("result"), failureCode: text("failure_code"), httpStatus: integer("http_status"),
}, (t) => [
  primaryKey({ columns: [t.ownerId, t.id] }), unique("ai_call_attempt").on(t.ownerId, t.logicalRequestKey, t.attemptOrdinal),
  foreignKey({ columns: [t.ownerId, t.id], foreignColumns: [costReservations.ownerId, costReservations.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.id], foreignColumns: [externalJobs.ownerId, externalJobs.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.id], foreignColumns: [externalAttempts.ownerId, externalAttempts.id] }).onDelete("restrict"),
  foreignKey({ columns: [t.ownerId, t.stepId], foreignColumns: [externalSteps.ownerId, externalSteps.id] }).onDelete("restrict"),
  check("ai_call_stage", sql.raw("stage IN ('intent','response-received','usage-stored','settled','validated','invalid','unknown')")),
  check("ai_call_version", sql.raw("typeof(version) = 'integer' AND version >= 1 AND version <= 9007199254740991")),
  check("ai_call_ordinal", sql.raw("typeof(attempt_ordinal) = 'integer' AND attempt_ordinal BETWEEN 1 AND 3")),
  check("ai_call_usage", sql.raw("usage IS NULL OR json_valid(usage)")),
  check("ai_call_result", sql.raw("result IS NULL OR json_valid(result)")),
]);

export const aiFundingChecks = sqliteTable("ai_funding_checks", {
  ownerId: text("owner_id").notNull(), reservationId: text("reservation_id").notNull(), snapshot: text("snapshot").notNull(), checkedAt: integer("checked_at").notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.reservationId] }), foreignKey({ columns: [t.ownerId, t.reservationId], foreignColumns: [costReservations.ownerId, costReservations.id] }).onDelete("restrict"), check("ai_funding_snapshot", sql.raw("json_valid(snapshot) AND json_extract(snapshot,'$.ownerId') = owner_id AND json_extract(snapshot,'$.automaticRecharge') = 0"))]);
