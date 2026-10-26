import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { googleConnections } from "./learning-schema.ts";

/** OAuth 시도에는 state·브라우저 핸들·nonce의 해시만 저장합니다. */
export const googleOAuthAttempts = sqliteTable("google_oauth_attempts", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), stateHash: text("state_hash").notNull(), handleHash: text("handle_hash").notNull(), nonceHash: text("nonce_hash").notNull(),
  callbackUrl: text("callback_url").notNull(), purpose: text("purpose").notNull(), connectionId: text("connection_id"), connectionGeneration: integer("connection_generation"),
  createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(), consumedAt: integer("consumed_at"),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), unique("google_oauth_state_unique").on(t.stateHash), index("google_oauth_expiry").on(t.expiresAt),
  check("google_oauth_hashes", sql.raw("length(state_hash)=64 AND length(handle_hash)=64 AND length(nonce_hash)=64")),
  check("google_oauth_lifetime", sql.raw("created_at>=0 AND expires_at>created_at AND expires_at-created_at<=600000 AND (consumed_at IS NULL OR (consumed_at>=created_at AND consumed_at<expires_at))")),
  check("google_oauth_purpose", sql.raw("(purpose='connect' AND connection_id IS NULL AND connection_generation IS NULL) OR (purpose='reconnect' AND length(connection_id)=36 AND connection_generation>=1)")),
]);

/** 소유자별 현재 연결 세대와 갱신 소유권은 D1 한 행에서 관리합니다. */
export const googleRuntime = sqliteTable("google_runtime", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), version: integer("version").notNull(), lastRequestId: text("last_request_id").notNull(),
  connectionId: text("connection_id").notNull(), generation: integer("generation").notNull(), state: text("state").notNull(), googleEmail: text("google_email").notNull(),
  authorizedAt: integer("authorized_at").notNull(), refreshExpiresAt: integer("refresh_expires_at"), refreshLeaseId: text("refresh_lease_id"), refreshLeaseExpiresAt: integer("refresh_lease_expires_at"),
  storageEvidence: text("storage_evidence"), providerRevocation: text("provider_revocation").notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), unique("google_runtime_owner").on(t.ownerId), foreignKey({ columns: [t.ownerId, t.connectionId], foreignColumns: [googleConnections.ownerId, googleConnections.id] }),
  check("google_runtime_versions", sql.raw("version>=1 AND generation>=1")),
  check("google_runtime_state", sql.raw("state IN ('active','partial','refreshing','refresh-unknown','reconsent','disconnecting','disconnected')")),
  check("google_runtime_lease", sql.raw("(state='refreshing' AND refresh_lease_id IS NOT NULL AND refresh_lease_expires_at IS NOT NULL) OR (state!='refreshing' AND refresh_lease_id IS NULL AND refresh_lease_expires_at IS NULL)")),
  check("google_runtime_storage", sql.raw("storage_evidence IS NULL OR json_valid(storage_evidence)")),
  check("google_runtime_revocation", sql.raw("provider_revocation IN ('none','pending','revoked','failed','unknown')")),
]);

/** 파일 선택 시도와 승인 역할은 현재 연결 세대에 묶어 재연결 시 재사용을 금지합니다. */
export const googlePickerLeases = sqliteTable("google_picker_leases", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), connectionId: text("connection_id").notNull(), generation: integer("generation").notNull(),
  role: text("role").notNull(), issuedAt: integer("issued_at").notNull(), expiresAt: integer("expires_at").notNull(), state: text("state").notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), foreignKey({ columns: [t.ownerId, t.connectionId], foreignColumns: [googleConnections.ownerId, googleConnections.id] }),
  check("google_picker_lifetime", sql.raw("generation>=1 AND issued_at>=0 AND expires_at>issued_at AND expires_at-issued_at<=60000")),
  check("google_picker_state", sql.raw("state IN ('active','consumed','canceled')")), check("google_picker_role", sql.raw("role IN ('reference','docs-target','sheets-target')")),
]);
export const googleResources = sqliteTable("google_resources", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), connectionId: text("connection_id").notNull(), generation: integer("generation").notNull(),
  externalId: text("external_id").notNull(), role: text("role").notNull(), source: text("source").notNull(), evidenceId: text("evidence_id").notNull(),
  approvedAt: integer("approved_at").notNull(), metadata: text("metadata").notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), unique("google_resource_identity").on(t.ownerId, t.connectionId, t.generation, t.externalId, t.role), foreignKey({ columns: [t.ownerId, t.connectionId], foreignColumns: [googleConnections.ownerId, googleConnections.id] }),
  check("google_resource_role", sql.raw("role IN ('reference','docs-target','sheets-target','calendar-target')")),
  check("google_resource_source", sql.raw("source IN ('picker','app-created') AND (role!='calendar-target' OR (source='app-created' AND external_id!='primary'))")),
  check("google_resource_metadata", sql.raw("generation>=1 AND approved_at>=0 AND json_valid(metadata)")),
]);

/** quota 설정 버전이 바뀌어도 이전 시도와 사용량 기록은 유지합니다. */
export const googleQuotaPolicies = sqliteTable("google_quota_policies", {
  ownerId: text("owner_id").notNull(), projectId: text("project_id").notNull(), version: integer("version").notNull(), hash: text("hash").notNull(), snapshot: text("snapshot").notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.projectId] }), check("google_quota_policy_data", sql.raw("version>=1 AND length(hash)=64 AND json_valid(snapshot)"))]);
export const googleRequests = sqliteTable("google_requests", {
  ownerId: text("owner_id").notNull(), id: text("id").notNull(), projectId: text("project_id").notNull(), googleSubject: text("google_subject").notNull(), connectionId: text("connection_id").notNull(), generation: integer("generation").notNull(),
  policyVersion: integer("policy_version").notNull(), method: text("method").notNull(), requestHash: text("request_hash").notNull(), state: text("state").notNull(),
  reservedAt: integer("reserved_at").notNull(), expiresAt: integer("expires_at").notNull(), sentAt: integer("sent_at"), finishedAt: integer("finished_at"),
  storageBytes: integer("storage_bytes").notNull(), status: integer("status"), errorCode: text("error_code"), resultExternalId: text("result_external_id"),
}, t => [primaryKey({ columns: [t.ownerId, t.id] }), foreignKey({ columns: [t.ownerId, t.connectionId], foreignColumns: [googleConnections.ownerId, googleConnections.id] }), index("google_request_storage").on(t.ownerId, t.projectId, t.googleSubject, t.reservedAt),
  check("google_request_state", sql.raw("state IN ('reserved','sending','succeeded','failed','unknown')")),
  check("google_request_data", sql.raw("generation>=1 AND policy_version>=1 AND length(request_hash)=64 AND reserved_at>=0 AND expires_at>reserved_at AND storage_bytes>=0 AND storage_bytes<=10485760")),
]);
export const googleQuotaCharges = sqliteTable("google_quota_charges", {
  ownerId: text("owner_id").notNull(), requestId: text("request_id").notNull(), projectId: text("project_id").notNull(), dimensionKey: text("dimension_key").notNull(), subject: text("subject").notNull(),
  weight: integer("weight").notNull(), reservedAt: integer("reserved_at").notNull(),
}, t => [primaryKey({ columns: [t.ownerId, t.requestId, t.dimensionKey, t.subject] }), foreignKey({ columns: [t.ownerId, t.requestId], foreignColumns: [googleRequests.ownerId, googleRequests.id] }), index("google_charge_window").on(t.ownerId, t.projectId, t.dimensionKey, t.subject, t.reservedAt), check("google_charge_units", sql.raw("weight>0 AND weight<=1000000000000 AND reserved_at>=0"))]);

/** 제공사 한도·설정 오류는 확인되지 않은 반복 호출을 막는 별도 차단 근거입니다. */
export const googleProviderBlocks = sqliteTable("google_provider_blocks", {
  ownerId: text("owner_id").notNull(), projectId: text("project_id").notNull(), api: text("api").notNull(), policyVersion: integer("policy_version").notNull(),
  reason: text("reason").notNull(), status: integer("status").notNull(), blockedAt: integer("blocked_at").notNull(), blockedUntil: integer("blocked_until"),
}, t => [primaryKey({ columns: [t.ownerId, t.projectId, t.api] }), check("google_provider_block_data", sql.raw("policy_version>=1 AND blocked_at>=0 AND (blocked_until IS NULL OR blocked_until>blocked_at) AND reason IN ('quota','storage-full','api-disabled')"))]);
