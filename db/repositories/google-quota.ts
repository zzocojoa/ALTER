import { z } from "zod";
import { command, contentHash, recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import { googleQuotaPolicy, requireGoogleQuotaPolicySuccessor } from "../../lib/google/quota.ts";
import type { GoogleQuotaPlan, GoogleQuotaPolicy } from "../../lib/google/quota.ts";
import { requireGoogleStorage } from "../../lib/google/project.ts";
import type { GoogleStorageEvidence } from "../../lib/google/project.ts";
import { googleMethodPolicies } from "../../lib/google/permissions.ts";
import { executeAtomic, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import type { ManagedGoogleConnection } from "./google-managed.ts";

/** 서버가 확인한 프로젝트 설정을 설치하며 일반 사용자 요청 본문에서는 호출하지 않습니다. */
export async function installGoogleQuotaPolicy(db: D1Database, owner: SiteIdentity, value: GoogleQuotaPolicy): Promise<Receipt> {
  const policy: GoogleQuotaPolicy = googleQuotaPolicy.parse(value); siteIdentity.parse(owner);
  if (policy.ownerId !== owner.userId) throw googleFailure("google_quota_unverified", "quota-owner");
  const previous = await readStorage("google.quota.policy", () => db.prepare("SELECT version,hash,snapshot FROM google_quota_policies WHERE owner_id=? AND project_id=?").bind(owner.userId, policy.projectId).first<{ version: number; hash: string; snapshot: string }>());
  const hash: string = await contentHash(policy);
  if (previous && previous.hash !== hash) requireGoogleQuotaPolicySuccessor(googleQuotaPolicy.parse(JSON.parse(previous.snapshot)), policy);
  const id: string = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return executeAtomic(db, command.parse({ owner, requestKey: `policy:${policy.projectId}:${policy.version}:${hash}`, expectedVersion: policy.version }), "google.quota.install", { hash }, id, policy.version, requestId => [
    requireInBatch(db, owner.userId, requestId, 0, previous ? "EXISTS(SELECT 1 FROM google_quota_policies WHERE owner_id=? AND project_id=? AND version=? AND hash=?)" : "NOT EXISTS(SELECT 1 FROM google_quota_policies WHERE owner_id=? AND project_id=?)", previous ? [owner.userId, policy.projectId, previous.version, previous.hash] : [owner.userId, policy.projectId]),
    db.prepare("INSERT INTO google_quota_policies VALUES (?,?,?,?,?) ON CONFLICT(owner_id,project_id) DO UPDATE SET version=excluded.version,hash=excluded.hash,snapshot=excluded.snapshot").bind(owner.userId, policy.projectId, policy.version, hash, JSON.stringify(policy)),
  ]);
}
export type GoogleReservation = Readonly<{ attemptId: string; requestHash: string; storageBytes: number; now: number }>;

/** 저장한 시도는 결과 불명·실패여도 환급하지 않으며 모든 quota 차원을 같은 batch로 검사합니다. */
async function reserveGoogleCall(db: D1Database, owner: SiteIdentity, connection: ManagedGoogleConnection, plan: GoogleQuotaPlan, input: GoogleReservation, storage: GoogleStorageEvidence | null): Promise<Receipt> {
  recordId.parse(input.attemptId); timestamp.parse(input.now); z.string().regex(/^[a-f0-9]{64}$/).parse(input.requestHash); z.number().int().min(0).max(10_485_760).parse(input.storageBytes);
  if (plan.ownerId !== owner.userId || plan.validUntil <= input.now || plan.checkedAt > input.now || !["active", "partial"].includes(connection.state) || plan.charges.length === 0) throw googleFailure("google_quota_unverified", "reserve-evidence");
  if (storage) requireGoogleStorage(storage, owner.userId, plan.projectId, connection.googleSubject, "0", String(input.storageBytes), input.now);
  else if (plan.method !== "drive.about.get" || input.storageBytes !== 0) throw googleFailure("google_storage_unverified", "reserve-storage");
  const action = googleMethodPolicies[plan.method].action;
  if ((action === "write" || action === "create") && plan.method !== "calendar.events.delete" && input.storageBytes === 0) throw googleFailure("google_storage_unverified", "write-storage-bound");
  const context = command.parse({ owner, requestKey: input.attemptId, expectedVersion: 1 });
  return executeAtomic(db, context, "google.request.reserve", { plan, input, connectionId: connection.connectionId, generation: connection.generation }, input.attemptId, 1, requestId => {
    const statements: D1PreparedStatement[] = [
      requireInBatch(db, owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM google_runtime r JOIN google_connections c ON c.owner_id=r.owner_id AND c.id=r.connection_id WHERE r.owner_id=? AND r.connection_id=? AND r.generation=? AND r.state IN ('active','partial') AND c.expires_at>? AND c.revoked_at IS NULL)", [owner.userId, connection.connectionId, connection.generation, input.now]),
      requireInBatch(db, owner.userId, requestId, 1, "EXISTS(SELECT 1 FROM google_quota_policies WHERE owner_id=? AND project_id=? AND version=? AND hash=?)", [owner.userId, plan.projectId, plan.policyVersion, plan.policyHash]),
      requireInBatch(db, owner.userId, requestId, 50, "NOT EXISTS(SELECT 1 FROM google_provider_blocks WHERE owner_id=? AND project_id=? AND api=? AND policy_version>=? AND (blocked_until IS NULL OR blocked_until>?) AND NOT(reason='storage-full' AND ?='drive.about.get'))", [owner.userId, plan.projectId, googleMethodPolicies[plan.method].api, plan.policyVersion, input.now, plan.method]),
      db.prepare("INSERT INTO google_requests VALUES (?,?,?,?,?,?,?,?,?,'reserved',?,?,NULL,NULL,?,NULL,NULL,NULL)").bind(owner.userId, input.attemptId, plan.projectId, connection.googleSubject, connection.connectionId, connection.generation, plan.policyVersion, plan.method, input.requestHash, input.now, Math.min(input.now + 30_000, plan.validUntil), input.storageBytes),
    ];
    for (const [index, charge] of plan.charges.entries()) {
      statements.push(db.prepare("INSERT INTO google_quota_charges VALUES (?,?,?,?,?,?,?)").bind(owner.userId, input.attemptId, plan.projectId, charge.key, charge.subject, charge.weight, input.now));
      statements.push(requireInBatch(db, owner.userId, requestId, index + 2, "? + (SELECT COALESCE(SUM(weight),0) FROM google_quota_charges WHERE owner_id=? AND project_id=? AND dimension_key=? AND subject=? AND reserved_at>=?) <= ?", [charge.consoleUsedUpper, owner.userId, plan.projectId, charge.key, charge.subject, charge.periodStart, charge.limit]));
    }
    if (storage?.limitBytes !== null && storage?.limitBytes !== undefined && storage.usedBytes !== null) statements.push(requireInBatch(db, owner.userId, requestId, plan.charges.length + 2, "CAST(? AS INTEGER) + (SELECT COALESCE(SUM(storage_bytes),0) FROM google_requests WHERE owner_id=? AND project_id=? AND google_subject=? AND (reserved_at>=? OR state IN ('reserved','sending','unknown'))) <= CAST(? AS INTEGER)", [storage.usedBytes, owner.userId, plan.projectId, connection.googleSubject, storage.checkedAt, storage.limitBytes]));
    return statements;
  });
}
export async function reserveGoogleRequest(db: D1Database, owner: SiteIdentity, connection: ManagedGoogleConnection, plan: GoogleQuotaPlan, input: GoogleReservation, storage: GoogleStorageEvidence): Promise<Receipt> {
  return reserveGoogleCall(db, owner, connection, plan, input, storage);
}
export async function reserveGoogleStorageProbe(db: D1Database, owner: SiteIdentity, connection: ManagedGoogleConnection, plan: GoogleQuotaPlan, input: GoogleReservation): Promise<Receipt> {
  if (plan.method !== "drive.about.get") throw googleFailure("google_storage_unverified", "storage-probe-method");
  return reserveGoogleCall(db, owner, connection, plan, input, null);
}

/** 백업 변경 감지의 부수 변경 수가 아닌 실제 UPDATE 반환 행으로 전송 권한을 판정합니다. */
export async function beginGoogleRequest(db: D1Database, owner: SiteIdentity, attemptId: string, requestHash: string, now: number): Promise<void> {
  recordId.parse(attemptId); timestamp.parse(now); siteIdentity.parse(owner);
  const result = await db.prepare("UPDATE google_requests SET state='sending',sent_at=? WHERE owner_id=? AND id=? AND request_hash=? AND state='reserved' AND reserved_at<=? AND expires_at>? AND EXISTS(SELECT 1 FROM google_runtime r WHERE r.owner_id=google_requests.owner_id AND r.connection_id=google_requests.connection_id AND r.generation=google_requests.generation AND r.state IN ('active','partial')) RETURNING id").bind(now, owner.userId, attemptId, requestHash, now, now).all<{ id: string }>();
  if (!result.success || result.results.length !== 1 || result.results[0].id !== attemptId) throw googleFailure("google_request_unknown", "request-not-sendable");
}
export type GoogleRequestResult = Readonly<{ state: "succeeded" | "failed" | "unknown"; status: number | null; errorCode: string | null; externalId: string | null; now: number }>;
export async function finishGoogleRequest(db: D1Database, owner: SiteIdentity, attemptId: string, value: GoogleRequestResult): Promise<void> {
  recordId.parse(attemptId); timestamp.parse(value.now); siteIdentity.parse(owner);
  const result = await db.prepare("UPDATE google_requests SET state=?,finished_at=?,status=?,error_code=?,result_external_id=? WHERE owner_id=? AND id=? AND state='sending' AND sent_at<=? RETURNING id").bind(value.state, value.now, value.status, value.errorCode, value.externalId, owner.userId, attemptId, value.now).all<{ id: string }>();
  if (!result.success || result.results.length !== 1 || result.results[0].id !== attemptId) throw googleFailure("google_request_unknown", "request-completion-unknown");
}
