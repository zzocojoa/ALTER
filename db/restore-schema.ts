import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** 저장소 표식은 백업 이력과 분리하며 실제 복원 완료나 실행 권한을 뜻하지 않습니다. */
export const restoreStorage = sqliteTable("restore_storage", {
  slot: integer("slot").primaryKey(), identity: text("identity").notNull(), state: text("state").notNull(),
  markerVersion: text("marker_version"), markerBytes: integer("marker_bytes"), createdAt: integer("created_at").notNull(), readyAt: integer("ready_at"),
}, t => [check("restore_storage_slot", sql`${t.slot}=1`),
  check("restore_storage_identity", sql`json_valid(${t.identity}) AND length(CAST(${t.identity} AS BLOB)) BETWEEN 1 AND 2048`),
  check("restore_storage_state", sql`(${t.state}='reserved' AND ${t.markerVersion} IS NULL AND ${t.markerBytes} IS NULL AND ${t.readyAt} IS NULL) OR (${t.state}='ready' AND ${t.markerVersion} IS NOT NULL AND length(${t.markerVersion})>0 AND ${t.markerBytes} IS NOT NULL AND ${t.readyAt} IS NOT NULL AND ${t.markerBytes} BETWEEN 1 AND 2048 AND ${t.readyAt}>=${t.createdAt})`),
  check("restore_storage_time", sql`${t.createdAt}>=0`)]);

/** 승인 요청은 실제 대상 저장소에 귀속되며 한 복원 실행에서만 소비합니다. */
export const restoreChallenges = sqliteTable("restore_challenges", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), targetIdentity: text("target_identity").notNull(),
  issuedAt: integer("issued_at").notNull(), expiresAt: integer("expires_at").notNull(), consumedAt: integer("consumed_at"), consumedRunId: text("consumed_run_id"),
}, t => [check("restore_challenge_time", sql`${t.issuedAt}>=0 AND ${t.expiresAt}>${t.issuedAt} AND ${t.expiresAt}-${t.issuedAt}<=900000 AND ((${t.consumedAt} IS NULL AND ${t.consumedRunId} IS NULL) OR (${t.consumedAt} IS NOT NULL AND ${t.consumedRunId} IS NOT NULL AND ${t.consumedAt}>=${t.issuedAt} AND ${t.consumedAt}<${t.expiresAt}))`)]);

/** 수신 중인 기록은 검증·활성화와 구분하고 백업이 실행 권한을 부여하지 못하게 합니다. */
export const restoreRuns = sqliteTable("restore_runs", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), challengeId: text("challenge_id").notNull().unique(),
  authorization: text("authorization").notNull(), startedAt: integer("started_at").notNull(), state: text("state").notNull(),
}, t => [foreignKey({ columns: [t.challengeId], foreignColumns: [restoreChallenges.id] }), check("restore_run_state", sql`${t.state} IN ('receiving','verifying','verified','activated','failed')`),
  check("restore_run_authorization", sql`json_valid(${t.authorization}) AND length(CAST(${t.authorization} AS BLOB)) BETWEEN 1 AND 8192 AND ${t.startedAt}>=0`)]);

/** 전체 수신 용량은 매니페스트에 묶고 D1에는 작은 영수증만 보관합니다. */
export const restoreArchives = sqliteTable("restore_archives", {
  runId: text("run_id").primaryKey(), manifestKey: text("manifest_key").notNull(), manifestSha256: text("manifest_sha256").notNull(), manifestBytes: integer("manifest_bytes").notNull(),
  reservedBytes: integer("reserved_bytes").notNull(), state: text("state").notNull(), objectVersion: text("object_version"), createdAt: integer("created_at").notNull(), readyAt: integer("ready_at"),
}, t => [foreignKey({ columns: [t.runId], foreignColumns: [restoreRuns.id] }),
  check("restore_archive_capacity", sql`${t.manifestBytes} BETWEEN 1 AND 8388608 AND ${t.reservedBytes}>=${t.manifestBytes}+3072 AND ${t.reservedBytes}<=268435456`),
  check("restore_archive_state", sql`(${t.state}='reserved' AND ${t.objectVersion} IS NULL AND ${t.readyAt} IS NULL) OR (${t.state}='ready' AND ${t.objectVersion} IS NOT NULL AND length(${t.objectVersion})>0 AND ${t.readyAt} IS NOT NULL AND ${t.readyAt}>=${t.createdAt})`),
  check("restore_archive_time", sql`${t.createdAt}>=0`)]);
/** 중간 페이지는 원본 바이트 해시를 통과한 뒤에만 영수증을 기록하며 학습 테이블에 아직 적재하지 않습니다. */
export const restorePageReceipts = sqliteTable("restore_page_receipts", {
  runId: text("run_id").notNull(), path: text("path").notNull(), objectKey: text("object_key").notNull(), objectVersion: text("object_version").notNull(),
  bytes: integer("bytes").notNull(), sha256: text("sha256").notNull(), receivedAt: integer("received_at").notNull(),
}, t => [primaryKey({ columns: [t.runId, t.path] }), foreignKey({ columns: [t.runId], foreignColumns: [restoreArchives.runId] }),
  check("restore_page_receipt_size", sql`${t.bytes} BETWEEN 1 AND 4194304 AND ${t.receivedAt}>=0 AND length(${t.objectVersion})>0`)]);

/** 원본 식별자·선언 해시는 고정하고 복원 후 새 R2 버전만 별도로 기록합니다. */
export const restoreOriginals = sqliteTable("restore_originals", {
  runId: text("run_id").notNull(), ordinal: integer("ordinal").notNull(), plan: text("plan").notNull(), sourcePages: text("source_pages").notNull(),
  state: text("state").notNull(), objectVersion: text("object_version"), etag: text("etag"), createdAt: integer("created_at").notNull(), verifiedAt: integer("verified_at"),
}, t => [primaryKey({ columns: [t.runId, t.ordinal] }), foreignKey({ columns: [t.runId], foreignColumns: [restoreArchives.runId] }),
  check("restore_original_plan", sql`json_valid(${t.plan}) AND json_valid(${t.sourcePages}) AND length(CAST(${t.plan} AS BLOB)) BETWEEN 1 AND 8192 AND ${t.ordinal} BETWEEN 0 AND 9999`),
  check("restore_original_state", sql`(${t.state}='reserved' AND ${t.objectVersion} IS NULL AND ${t.etag} IS NULL AND ${t.verifiedAt} IS NULL) OR (${t.state}='verified' AND ${t.objectVersion} IS NOT NULL AND length(${t.objectVersion})>0 AND ${t.etag} IS NOT NULL AND length(${t.etag})>0 AND ${t.verifiedAt} IS NOT NULL AND ${t.verifiedAt}>=${t.createdAt})`),
  check("restore_original_time", sql`${t.createdAt}>=0`)]);

/** 적재 진행은 원본 수신과 분리하고 페이지 전체가 커밋될 때만 한 칸 이동합니다. */
export const restoreImports = sqliteTable("restore_imports", {
  runId: text("run_id").primaryKey(), manifestSha256: text("manifest_sha256").notNull(), expectedPages: integer("expected_pages").notNull(), loadedPages: integer("loaded_pages").notNull(), startedAt: integer("started_at").notNull(),
}, t => [foreignKey({ columns: [t.runId], foreignColumns: [restoreArchives.runId] }), check("restore_import_progress", sql`${t.expectedPages} BETWEEN 1 AND 10000 AND ${t.loadedPages} BETWEEN 0 AND ${t.expectedPages} AND ${t.startedAt}>=0`)]);
export const restoreImportPages = sqliteTable("restore_import_pages", {
  runId: text("run_id").notNull(), path: text("path").notNull(), sequence: integer("sequence").notNull(), sourceSha256: text("source_sha256").notNull(), projectedSha256: text("projected_sha256").notNull(), rowCount: integer("row_count").notNull(), loadedAt: integer("loaded_at").notNull(),
}, t => [primaryKey({ columns: [t.runId, t.path] }), foreignKey({ columns: [t.runId], foreignColumns: [restoreImports.runId] }), check("restore_import_page_data", sql`${t.sequence} BETWEEN 0 AND 9999 AND ${t.rowCount} BETWEEN 0 AND 32 AND ${t.loadedAt}>=0`)]);
/** 이 행은 한 D1 배치 안에서 만들고 지웁니다. 학습 API에는 이 범위를 여는 경로가 없습니다. */
export const restoreImportScopes = sqliteTable("restore_import_scopes", {
  slot: integer("slot").primaryKey(), runId: text("run_id").notNull(), ownerId: text("owner_id").notNull(), tableName: text("table_name").notNull(), path: text("path").notNull(), sourceSha256: text("source_sha256").notNull(),
}, t => [foreignKey({ columns: [t.runId], foreignColumns: [restoreImports.runId] }), check("restore_import_scope_slot", sql`${t.slot}=1`)]);

/** 모든 검증 영수증은 적재 완료 시점의 DB 변경 번호에 묶입니다. */
export const restoreVerifications = sqliteTable("restore_verifications", {
  runId: text("run_id").primaryKey(), manifestSha256: text("manifest_sha256").notNull(), revision: integer("revision").notNull(), pageCount: integer("page_count").notNull(), objectCount: integer("object_count").notNull(), rowCount: integer("row_count").notNull(), startedAt: integer("started_at").notNull(), completedAt: integer("completed_at"),
}, t => [foreignKey({ columns: [t.runId], foreignColumns: [restoreImports.runId] }), check("restore_verification_bounds", sql`${t.revision}>=0 AND ${t.pageCount} BETWEEN 1 AND 10000 AND ${t.objectCount} BETWEEN 0 AND 10000 AND ${t.rowCount}>=0 AND ${t.startedAt}>=0 AND (${t.completedAt} IS NULL OR ${t.completedAt}>=${t.startedAt})`)]);
export const restoreVerificationItems = sqliteTable("restore_verification_items", {
  runId: text("run_id").notNull(), path: text("path").notNull(), kind: text("kind").notNull(), sha256: text("sha256").notNull(), projectedSha256: text("projected_sha256"), objectVersion: text("object_version"), verifiedAt: integer("verified_at").notNull(),
}, t => [primaryKey({ columns: [t.runId, t.path] }), foreignKey({ columns: [t.runId], foreignColumns: [restoreVerifications.runId] }), check("restore_verification_item", sql`${t.verifiedAt}>=0 AND length(${t.sha256})=64 AND ((${t.kind}='page' AND ${t.projectedSha256} IS NOT NULL AND length(${t.projectedSha256})=64 AND ${t.objectVersion} IS NULL) OR (${t.kind}='original' AND ${t.projectedSha256} IS NULL AND ${t.objectVersion} IS NOT NULL AND length(${t.objectVersion})>0))`)]);

/** 활성화 영수증은 학습 접근만 열고 현재 외부 실행 권한은 미확인으로 고정합니다. */
export const restoreActivations = sqliteTable("restore_activations", {
  runId: text("run_id").primaryKey(), revision: integer("revision").notNull(), activatedAt: integer("activated_at").notNull(), externalAuthority: text("external_authority").notNull(),
}, t => [foreignKey({ columns: [t.runId], foreignColumns: [restoreVerifications.runId] }), check("restore_activation_bounds", sql`${t.revision}>=0 AND ${t.activatedAt}>=0 AND ${t.externalAuthority}='unverified'`)]);

/** 복원 이력의 조회 결과를 별도 보관하며 원래 작업 상태나 실행 권한을 변경하지 않습니다. */
export const restoreReconciliations = sqliteTable("restore_reconciliations", {
  id: text("id").primaryKey(), runId: text("run_id").notNull(), ownerId: text("owner_id").notNull(), operationId: text("operation_id").notNull(), operationVersion: integer("operation_version").notNull(),
  connectionId: text("connection_id").notNull(), generation: integer("generation").notNull(), startedAt: integer("started_at").notNull(), expiresAt: integer("expires_at").notNull(), finishedAt: integer("finished_at"), proof: text("proof"),
}, t => [foreignKey({ columns: [t.runId], foreignColumns: [restoreActivations.runId] }),
  check("restore_reconciliation_bounds", sql`${t.operationVersion}>0 AND ${t.generation}>0 AND ${t.startedAt}>=0 AND ${t.expiresAt}>${t.startedAt} AND ${t.expiresAt}<=${t.startedAt}+60000`),
  check("restore_reconciliation_result", sql`(${t.finishedAt} IS NULL AND ${t.proof} IS NULL) OR (${t.finishedAt}>=${t.startedAt} AND ${t.proof} IS NOT NULL AND json_valid(${t.proof}) AND length(CAST(${t.proof} AS BLOB))<=4096)`)]);

/** 현재 읽기 예약은 과거 Google 원장과 분리하며 실패·응답 유실도 quota에서 환급하지 않습니다. */
export const restoreGoogleReads = sqliteTable("restore_google_reads", {
  id: text("id").primaryKey(), reconciliationId: text("reconciliation_id").notNull(), requestHash: text("request_hash").notNull(), method: text("method").notNull(), projectId: text("project_id").notNull(),
  policyVersion: integer("policy_version").notNull(), policyHash: text("policy_hash").notNull(), policy: text("policy").notNull(), charges: text("charges").notNull(), reservedAt: integer("reserved_at").notNull(), expiresAt: integer("expires_at").notNull(),
  state: text("state").notNull(), sentAt: integer("sent_at"), finishedAt: integer("finished_at"), status: integer("status"), error: text("error"),
}, t => [foreignKey({ columns: [t.reconciliationId], foreignColumns: [restoreReconciliations.id] }),
  check("restore_google_read_method", sql`${t.method} IN ('drive.files.get','drive.files.list','docs.documents.get','sheets.spreadsheets.get','sheets.values.get','calendar.calendars.get','calendar.events.get')`),
  check("restore_google_read_quota", sql`${t.policyVersion}>0 AND json_valid(${t.policy}) AND json_valid(${t.charges}) AND length(CAST(${t.policy} AS BLOB))<=65536 AND length(CAST(${t.charges} AS BLOB))<=16384 AND ${t.reservedAt}>=0 AND ${t.expiresAt}>${t.reservedAt}`),
  check("restore_google_read_state", sql`(${t.state}='reserved' AND ${t.sentAt} IS NULL AND ${t.finishedAt} IS NULL) OR (${t.state}='sending' AND ${t.sentAt}>=${t.reservedAt} AND ${t.finishedAt} IS NULL) OR (${t.state} IN ('succeeded','failed','unknown') AND ${t.sentAt}>=${t.reservedAt} AND ${t.finishedAt}>=${t.sentAt})`)]);
