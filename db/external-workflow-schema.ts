import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { externalJobs, externalSteps, googleConnections } from "./learning-schema.ts";
import { googleRequests } from "./google-auth-schema.ts";

/** 기존 작업 ID와 AI 기록은 유지하며 Google 작업의 복구 상태만 별도로 영속화합니다. */
export const externalWorkflows = sqliteTable("external_workflows", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(),
  kind: text("kind").notNull(), targetKey: text("target_key").notNull(), sourceVersion: text("source_version").notNull(), requestHash: text("request_hash").notNull(), snapshot: text("snapshot").notNull(),
  connectionId: text("connection_id").notNull(), googleSubject: text("google_subject").notNull(), generation: integer("generation").notNull(), state: text("state").notNull(), createdAt: integer("created_at").notNull(), deadlineAt: integer("deadline_at").notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), foreignKey({ columns: [t.ownerId, t.id], foreignColumns: [externalJobs.ownerId, externalJobs.id] }).onDelete("restrict"), foreignKey({ columns: [t.ownerId, t.connectionId], foreignColumns: [googleConnections.ownerId, googleConnections.id] }).onDelete("restrict"),
  unique("external_workflow_business_version").on(t.ownerId, t.kind, t.targetKey, t.sourceVersion), index("external_workflow_target").on(t.ownerId, t.targetKey, t.state),
  check("external_workflow_identity", sql.raw("version>=1 AND generation>=1 AND kind IN ('weekly-export','calendar') AND length(target_key)>0 AND length(source_version)>0 AND length(google_subject)>0")),
  check("external_workflow_snapshot", sql.raw("length(request_hash)=64 AND json_valid(snapshot) AND created_at>=0 AND deadline_at>created_at")),
  check("external_workflow_state", sql.raw("state IN ('pending','running','partial','confirmed','failed','unknown','conflict')")),
]);

/** 같은 확정본의 다른 요청도 원래 작업으로 연결합니다. */
export const externalRequestKeys = sqliteTable("external_request_keys", {
  ownerId: text("owner_id").notNull(), requestKey: text("request_key").notNull(), workflowId: text("workflow_id").notNull(), requestHash: text("request_hash").notNull(), createdAt: integer("created_at").notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.requestKey] }), foreignKey({ columns: [t.ownerId, t.workflowId], foreignColumns: [externalWorkflows.ownerId, externalWorkflows.id] }).onDelete("restrict"), check("external_request_key_data", sql.raw("length(request_key)>0 AND length(request_key)<=200 AND length(request_hash)=64 AND created_at>=0"))]);

/** 문서 생성·본문 쓰기·검증을 나누되 기존 서비스 단계에 연결합니다. */
export const externalOperations = sqliteTable("external_operations", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(), workflowId: text("workflow_id").notNull(), stepId: text("step_id").notNull(), ordinal: integer("ordinal").notNull(),
  kind: text("kind").notNull(), businessKey: text("business_key").notNull(), snapshot: text("snapshot").notNull(), requestHash: text("request_hash").notNull(), expectedHash: text("expected_hash").notNull(), externalId: text("external_id"),
  state: text("state").notNull(), leaseId: text("lease_id"), leaseEpoch: integer("lease_epoch").notNull(), leaseUntil: integer("lease_until"), intentAt: integer("intent_at"), responseAt: integer("response_at"),
  attemptCount: integer("attempt_count").notNull(), nextAttemptAt: integer("next_attempt_at").notNull(), verification: text("verification"), lastError: text("last_error"),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), foreignKey({ columns: [t.ownerId, t.workflowId], foreignColumns: [externalWorkflows.ownerId, externalWorkflows.id] }).onDelete("restrict"), foreignKey({ columns: [t.ownerId, t.stepId], foreignColumns: [externalSteps.ownerId, externalSteps.id] }).onDelete("restrict"),
  unique("external_operation_order").on(t.ownerId, t.workflowId, t.ordinal), index("external_operation_pending").on(t.ownerId, t.workflowId, t.state),
  check("external_operation_data", sql.raw("version>=1 AND ordinal>=1 AND ordinal<=40 AND length(kind)>0 AND length(business_key)>0 AND length(request_hash)=64 AND length(expected_hash)=64 AND json_valid(snapshot) AND attempt_count>=0 AND lease_epoch>=0 AND next_attempt_at>=0")),
  check("external_operation_state", sql.raw("state IN ('pending','running','received','confirmed','failed','unknown','conflict')")),
  check("external_operation_lease", sql.raw("(state='running' AND lease_id IS NOT NULL AND lease_until IS NOT NULL AND lease_epoch>=1) OR (state!='running' AND lease_id IS NULL AND lease_until IS NULL)")),
  check("external_operation_times", sql.raw("(intent_at IS NULL OR intent_at>=0) AND (response_at IS NULL OR (intent_at IS NOT NULL AND response_at>=intent_at))")),
  check("external_operation_evidence", sql.raw("(verification IS NULL OR json_valid(verification)) AND (last_error IS NULL OR json_valid(last_error)) AND (state!='received' OR response_at IS NOT NULL) AND (state!='confirmed' OR (external_id IS NOT NULL AND verification IS NOT NULL AND coalesce(json_extract(verification,'$.status'),'')='matched' AND coalesce(json_extract(verification,'$.expectedHash'),'')=expected_hash AND coalesce(json_extract(verification,'$.checkedAt'),-1)>=0))")),
]);

/** 쓰기와 복구 조회는 서로 다른 시도이며 과거의 결과 불명을 덮어쓰지 않습니다. */
export const externalAttemptRecords = sqliteTable("external_attempt_records", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), operationId: text("operation_id").notNull(), ordinal: integer("ordinal").notNull(), leaseId: text("lease_id").notNull(), leaseEpoch: integer("lease_epoch").notNull(), mode: text("mode").notNull(),
  state: text("state").notNull(), startedAt: integer("started_at").notNull(), finishedAt: integer("finished_at"), providerRequestId: text("provider_request_id"), statusCode: integer("status_code"), error: text("error"), verification: text("verification"),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), foreignKey({ columns: [t.ownerId, t.operationId], foreignColumns: [externalOperations.ownerId, externalOperations.id] }).onDelete("restrict"), foreignKey({ columns: [t.ownerId, t.providerRequestId], foreignColumns: [googleRequests.ownerId, googleRequests.id] }).onDelete("restrict"), unique("external_attempt_record_order").on(t.ownerId, t.operationId, t.ordinal),
  check("external_attempt_record_identity", sql.raw("ordinal>=1 AND lease_epoch>=1 AND length(lease_id)=36 AND mode IN ('write','verify')")),
  check("external_attempt_record_state", sql.raw("state IN ('started','received','verified','failed','unknown','conflict','not-sent') AND ((state='started' AND finished_at IS NULL) OR (state!='started' AND finished_at IS NOT NULL AND finished_at>=started_at))")),
  check("external_attempt_record_evidence", sql.raw("started_at>=0 AND (status_code IS NULL OR (status_code>=100 AND status_code<=599)) AND (error IS NULL OR json_valid(error)) AND (verification IS NULL OR json_valid(verification)) AND (state!='verified' OR (verification IS NOT NULL AND coalesce(json_extract(verification,'$.status'),'')='matched'))")),
]);

/** 결과 불명인 쓰기는 임대가 만료돼도 같은 성과표의 다음 쓰기를 막습니다. */
export const externalSheetLocks=sqliteTable("external_sheet_locks",{
  ownerId:text("owner_id").notNull(),googleSubject:text("google_subject").notNull(),externalId:text("external_id").notNull(),operationId:text("operation_id").notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.googleSubject,t.externalId]}),foreignKey({columns:[t.ownerId,t.operationId],foreignColumns:[externalOperations.ownerId,externalOperations.id]}).onDelete("restrict"),check("external_sheet_lock_identity",sql.raw("length(google_subject)>0 AND length(external_id)>0"))]);

/** 보조 메타데이터 조회까지 외부 실행 시도에 연결하며 batch 내부 요청 수는 HTTP 호출 수와 구분합니다. */
export const externalGoogleRequests=sqliteTable("external_google_requests",{
  ownerId:text("owner_id").notNull(),id:text("id").notNull(),attemptId:text("attempt_id").notNull(),batchSubrequests:integer("batch_subrequests").notNull(),responseUpperBytes:integer("response_upper_bytes").notNull(),
},t=>[primaryKey({columns:[t.ownerId,t.id]}),foreignKey({columns:[t.ownerId,t.id],foreignColumns:[googleRequests.ownerId,googleRequests.id]}).onDelete("restrict"),foreignKey({columns:[t.ownerId,t.attemptId],foreignColumns:[externalAttemptRecords.ownerId,externalAttemptRecords.id]}).onDelete("restrict"),check("external_google_request_counts",sql.raw("batch_subrequests>=0 AND batch_subrequests<=2 AND response_upper_bytes>=65536"))]);
