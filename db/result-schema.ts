import { sql } from "drizzle-orm";
import { check,foreignKey,integer,primaryKey,sqliteTable,text,unique } from "drizzle-orm/sqlite-core";
import { sessions,confirmedResults,answers,reviewItems } from "./learning-schema.ts";
export const sessionConfirmations=sqliteTable("session_confirmations",{
  ownerId:text("owner_id").notNull(),sessionId:text("session_id").notNull(),resultVersionId:text("result_version_id").notNull(),sessionVersion:integer("session_version").notNull(),fingerprint:text("fingerprint").notNull(),judgment:text("judgment").notNull(),confirmedAt:integer("confirmed_at").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.sessionId]}),unique("session_confirmation_result").on(t.ownerId,t.resultVersionId),foreignKey({columns:[t.ownerId,t.sessionId],foreignColumns:[sessions.ownerId,sessions.id]}),foreignKey({columns:[t.ownerId,t.resultVersionId],foreignColumns:[confirmedResults.ownerId,confirmedResults.id]}),check("session_confirmation_values",sql.raw("session_version>=1 AND length(fingerprint)=64 AND json_valid(judgment)"))]);
/** 일정은 후속 복습 정책이 계산하며 최초 확정의 대상과 근거는 보존합니다. */
export const resultReviewTargets=sqliteTable("result_review_targets",{
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),resultVersionId:text("result_version_id").notNull(),reviewId:text("review_id").notNull(),answerId:text("answer_id").notNull(),kind:text("kind").notNull(),content:text("content").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.id]}),unique("result_review_target_kind").on(t.ownerId,t.resultVersionId,t.kind,t.answerId),foreignKey({columns:[t.ownerId,t.resultVersionId],foreignColumns:[confirmedResults.ownerId,confirmedResults.id]}),foreignKey({columns:[t.ownerId,t.reviewId],foreignColumns:[reviewItems.ownerId,reviewItems.id]}),foreignKey({columns:[t.ownerId,t.answerId],foreignColumns:[answers.ownerId,answers.id]}),check("result_review_target_values",sql.raw("kind IN ('self-explanation','variable','delayed-recall') AND json_valid(content)"))]);
