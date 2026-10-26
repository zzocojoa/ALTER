import { sql } from "drizzle-orm";
import { check,foreignKey,integer,primaryKey,sqliteTable,text } from "drizzle-orm/sqlite-core";
import { weeklyVersions,externalJobs } from "./learning-schema.ts";

/** 확정한 주장·원문·비유·시간 배정은 불변 버전으로 보관하고 내보내기는 허용 필드만 읽습니다. */
export const weeklySnapshots=sqliteTable("weekly_snapshots",{
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),content:text("content").notNull(),fingerprint:text("fingerprint").notNull(),exportJobId:text("export_job_id").notNull(),confirmedAt:integer("confirmed_at").notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.id]}),foreignKey({columns:[t.ownerId,t.id],foreignColumns:[weeklyVersions.ownerId,weeklyVersions.id]}),foreignKey({columns:[t.ownerId,t.exportJobId],foreignColumns:[externalJobs.ownerId,externalJobs.id]}),check("weekly_snapshot_content",sql.raw("json_valid(content) AND length(fingerprint)=64 AND confirmed_at>=0"))]);
