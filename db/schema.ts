import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 후보 저장은 권한 부여가 아닙니다. 비공개 정책과 실제 계정 확인 후 서버 설정으로 승인합니다. */
export const ownerEnrollment = sqliteTable("owner_enrollment", {
  slot: integer("slot").primaryKey(),
  userId: text("user_id").notNull(),
  requestedAt: integer("requested_at").notNull(),
});

export * from "./learning-schema.ts";

export * from "./ai-schema.ts";

export * from "./material-schema.ts";

export * from "./extraction-schema.ts";

export * from "./advisor-schema.ts";

export * from "./librarian-schema.ts";

export * from "./tutor-start-schema.ts";

export * from "./tutor-schema.ts";

export * from "./result-schema.ts";

export * from "./review-policy-schema.ts";

export * from "./weekly-schema.ts";

export * from "./google-auth-schema.ts";

export * from "./external-workflow-schema.ts";
export * from "./google-report-schema.ts";

export * from "./google-reference-schema.ts";

export * from "./backup-schema.ts";

export * from "./restore-schema.ts";
