import { sql } from "drizzle-orm";
import { check,foreignKey,integer,primaryKey,sqliteTable,text,unique } from "drizzle-orm/sqlite-core";
import { confirmedResults,reviewItems,sessions } from "./learning-schema.ts";
import { reviewSchedule } from "./tutor-start-schema.ts";

/** 원래 오답·도움 증거는 보존하고 현재 제안 포인터만 낙관적 잠금으로 갱신합니다. */
export const reviewPlans=sqliteTable("review_plans",{
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),version:integer("version").notNull(),lastRequestId:text("last_request_id").notNull(),evidence:text("evidence").notNull(),task:text("task").notNull(),currentProposalId:text("current_proposal_id").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.id]}),foreignKey({columns:[t.ownerId,t.id],foreignColumns:[reviewItems.ownerId,reviewItems.id]}),check("review_plan_values",sql.raw("version>=1 AND json_valid(evidence) AND json_valid(task)"))]);
export const reviewProposals=sqliteTable("review_proposals",{
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),reviewId:text("review_id").notNull(),basisResultVersionId:text("basis_result_version_id").notNull(),previousId:text("previous_id"),proposal:text("proposal").notNull(),decision:text("decision").notNull(),createdAt:integer("created_at").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.id]}),foreignKey({columns:[t.ownerId,t.reviewId],foreignColumns:[reviewPlans.ownerId,reviewPlans.id]}),foreignKey({columns:[t.ownerId,t.basisResultVersionId],foreignColumns:[confirmedResults.ownerId,confirmedResults.id]}),check("review_proposal_values",sql.raw("json_valid(proposal) AND json_valid(decision) AND created_at>=0"))]);
export const reviewSessions=sqliteTable("review_sessions",{
  ownerId:text("owner_id").notNull(),sessionId:text("session_id").notNull(),reviewId:text("review_id").notNull(),scheduleId:text("schedule_id").notNull(),binding:text("binding").notNull(),
},(t)=>[primaryKey({columns:[t.ownerId,t.sessionId]}),unique("review_schedule_session").on(t.ownerId,t.scheduleId),foreignKey({columns:[t.ownerId,t.sessionId],foreignColumns:[sessions.ownerId,sessions.id]}),foreignKey({columns:[t.ownerId,t.reviewId],foreignColumns:[reviewPlans.ownerId,reviewPlans.id]}),foreignKey({columns:[t.ownerId,t.scheduleId],foreignColumns:[reviewSchedule.ownerId,reviewSchedule.id]}),check("review_session_binding",sql.raw("json_valid(binding)"))]);
