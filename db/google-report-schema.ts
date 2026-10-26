import { sql } from "drizzle-orm";
import { check,foreignKey,integer,primaryKey,sqliteTable,text,unique } from "drizzle-orm/sqlite-core";
import { externalJobs,googleConnections } from "./learning-schema.ts";
import { googleRequests } from "./google-auth-schema.ts";

/** 첫 확정 보고서의 설정 작업을 계정마다 고정해 미확인 생성을 다른 보고서가 우회하지 못합니다. */
export const googleReportSetups=sqliteTable("google_report_setups",{
  ownerId:text("owner_id").notNull(),googleSubject:text("google_subject").notNull(),id:text("id").notNull(),jobId:text("job_id").notNull(),createdAt:integer("created_at").notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.googleSubject]}),unique("google_report_setup_job").on(t.ownerId,t.jobId),foreignKey({columns:[t.ownerId,t.jobId],foreignColumns:[externalJobs.ownerId,externalJobs.id]}).onDelete("restrict"),check("google_report_setup_identity",sql.raw("length(google_subject)>0 AND length(id)=36 AND created_at>=0"))]);

/** 폴더는 Picker 선택 대상이 아니며 성공한 앱 생성 영수증으로만 허용합니다. */
export const googleReportFolders=sqliteTable("google_report_folders",{
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),connectionId:text("connection_id").notNull(),generation:integer("generation").notNull(),externalId:text("external_id").notNull(),approvedAt:integer("approved_at").notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.id]}),unique("google_report_folder_identity").on(t.ownerId,t.connectionId,t.generation,t.externalId),foreignKey({columns:[t.ownerId,t.id],foreignColumns:[googleRequests.ownerId,googleRequests.id]}).onDelete("restrict"),foreignKey({columns:[t.ownerId,t.connectionId],foreignColumns:[googleConnections.ownerId,googleConnections.id]}).onDelete("restrict"),check("google_report_folder_identity_check",sql.raw("generation>=1 AND length(external_id)>0 AND approved_at>=0"))]);
