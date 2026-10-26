import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { sessions,answers,helpEvents,questions } from "./learning-schema.ts";
import { studyScopes } from "./librarian-schema.ts";

export const tutorSessions = sqliteTable("tutor_sessions", {
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),version:integer("version").notNull(),lastRequestId:text("last_request_id").notNull(),scopeId:text("scope_id").notNull(),state:text("state").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.id]}),foreignKey({columns:[t.ownerId,t.id],foreignColumns:[sessions.ownerId,sessions.id]}),foreignKey({columns:[t.ownerId,t.scopeId],foreignColumns:[studyScopes.ownerId,studyScopes.id]}),check("tutor_session_state",sql.raw("json_valid(state) AND version>=1 AND json_extract(state,'$.version')=version AND json_extract(state,'$.id')=id AND json_extract(state,'$.start.scopeId')=scope_id"))]);
/** 답안과 도움의 과거 상태는 변경할 수 없는 사건으로 보존합니다. */
export const tutorEvents = sqliteTable("tutor_events", {
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),sessionId:text("session_id").notNull(),version:integer("version").notNull(),content:text("content").notNull(),createdAt:integer("created_at").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.id]}),unique("tutor_event_version").on(t.ownerId,t.sessionId,t.version),foreignKey({columns:[t.ownerId,t.sessionId],foreignColumns:[tutorSessions.ownerId,tutorSessions.id]}),check("tutor_event_content",sql.raw("json_valid(content) AND version>=1"))]);

export const tutorHelpDetails=sqliteTable("tutor_help_details",{
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),sessionId:text("session_id").notNull(),answerId:text("answer_id").notNull(),stage:text("stage").notNull(),content:text("content").notNull(),committedAt:integer("committed_at").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.id]}),foreignKey({columns:[t.ownerId,t.id],foreignColumns:[helpEvents.ownerId,helpEvents.id]}),foreignKey({columns:[t.ownerId,t.sessionId],foreignColumns:[tutorSessions.ownerId,tutorSessions.id]}),foreignKey({columns:[t.ownerId,t.answerId],foreignColumns:[answers.ownerId,answers.id]}),check("tutor_help_details_content",sql.raw("json_valid(content) AND stage IN ('direction','small-question','similar-example','full-explanation')"))]);
/** 화면 수신 확인은 제공 시도 기록을 수정하지 않는 별도 사실입니다. */
export const tutorHelpDeliveries=sqliteTable("tutor_help_deliveries",{
  ownerId:text("owner_id").notNull(),helpId:text("help_id").notNull(),deliveredAt:integer("delivered_at").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.helpId]}),foreignKey({columns:[t.ownerId,t.helpId],foreignColumns:[tutorHelpDetails.ownerId,tutorHelpDetails.id]})]);

export const tutorVariations=sqliteTable("tutor_variations",{
  ownerId:text("owner_id").notNull(),questionId:text("question_id").notNull(),parentQuestionId:text("parent_question_id").notNull(),content:text("content").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.questionId]}),foreignKey({columns:[t.ownerId,t.questionId],foreignColumns:[questions.ownerId,questions.id]}),foreignKey({columns:[t.ownerId,t.parentQuestionId],foreignColumns:[questions.ownerId,questions.id]}),check("tutor_variation_content",sql.raw("json_valid(content) AND question_id!=parent_question_id AND json_extract(content,'$.questionId')=question_id AND json_extract(content,'$.parentQuestionId')=parent_question_id"))]);
