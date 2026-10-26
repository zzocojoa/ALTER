import { z } from "zod";
import { command, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleStorageEvidence } from "../../lib/google/project.ts";
import type { GoogleStorageEvidence } from "../../lib/google/project.ts";
import type { GoogleQuotaPlan } from "../../lib/google/quota.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import type { GoogleMethod } from "../../lib/google/permissions.ts";
import { googleMethodPolicies } from "../../lib/google/permissions.ts";
import { executeAtomic, guardedUpdate, readStorage } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import type { ManagedGoogleConnection } from "./google-managed.ts";

/** about.get으로 확인한 수치만 현재 연결의 저장 용량 근거로 보관합니다. */
export async function saveGoogleStorageObservation(db: D1Database, owner: SiteIdentity, connection: ManagedGoogleConnection, attemptId: string, projectId: string, response: unknown, now: number): Promise<Receipt> {
  const parsed = z.object({ storageQuota: z.object({ limit: z.string().regex(/^\d{1,19}$/), usage: z.string().regex(/^\d{1,19}$/) }) }).safeParse(response);
  if (!parsed.success) throw googleFailure("google_storage_unverified", "storage-quota-response");
  const evidence: GoogleStorageEvidence = googleStorageEvidence.parse({ ownerId: owner.userId, projectId, googleSubject: connection.googleSubject, state: "verified", limitBytes: parsed.data.storageQuota.limit, usedBytes: parsed.data.storageQuota.usage, source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get", checkedAt: now, validUntil: now + 3_600_000 });
  const context = command.parse({ owner, requestKey: `storage:${attemptId}`, expectedVersion: connection.version });
  return executeAtomic(db, context, "google.storage.observe", { evidence }, connection.id, connection.version + 1, requestId => [ ...guardedUpdate(db, "google_runtime", owner.userId, connection.id, connection.version, requestId, 0, "storage_evidence=?", [JSON.stringify(evidence)], "connection_id=? AND generation=? AND state IN ('active','partial') AND EXISTS(SELECT 1 FROM google_requests q WHERE q.owner_id=? AND q.id=? AND q.connection_id=? AND q.generation=? AND q.method='drive.about.get' AND q.state='succeeded')", [connection.connectionId, connection.generation, owner.userId, attemptId, connection.connectionId, connection.generation]),
    db.prepare("DELETE FROM google_provider_blocks WHERE owner_id=? AND project_id=? AND reason='storage-full' AND CAST(? AS INTEGER)<CAST(? AS INTEGER)").bind(owner.userId, projectId, evidence.usedBytes, evidence.limitBytes),
  ]);
}
export async function recordGoogleProviderBlock(db: D1Database, owner: SiteIdentity, plan: GoogleQuotaPlan, reason: "quota" | "storage-full" | "api-disabled", status: number, until: number | null, now: number): Promise<void> {
  timestamp.parse(now); if (until !== null) timestamp.parse(until);
  await db.prepare("INSERT INTO google_provider_blocks VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,project_id,api) DO UPDATE SET policy_version=excluded.policy_version,reason=excluded.reason,status=excluded.status,blocked_at=excluded.blocked_at,blocked_until=excluded.blocked_until WHERE excluded.policy_version>google_provider_blocks.policy_version OR (excluded.policy_version=google_provider_blocks.policy_version AND google_provider_blocks.blocked_until IS NOT NULL AND (excluded.blocked_until IS NULL OR excluded.blocked_until>google_provider_blocks.blocked_until))").bind(owner.userId, plan.projectId, googleMethodPolicies[plan.method].api, plan.policyVersion, reason, status, now, until).run();
}
export async function requireGoogleProviderAvailable(db: D1Database, owner: SiteIdentity, projectId: string, method: GoogleMethod, policyVersion: number, now: number): Promise<void> {
  const api: string = googleMethodPolicies[method].api;
  const row = await readStorage("google.provider.block", () => db.prepare("SELECT reason FROM google_provider_blocks WHERE owner_id=? AND project_id=? AND api=? AND policy_version>=? AND (blocked_until IS NULL OR blocked_until>?) AND NOT(reason='storage-full' AND ?='drive.about.get')").bind(owner.userId, projectId, api, policyVersion, now, method).first<{ reason: string }>());
  if (row) throw googleFailure(row.reason === "storage-full" ? "google_storage_exhausted" : row.reason === "api-disabled" ? "google_api_disabled" : "google_quota_exhausted", api);
}
/** 제공사가 철회한 연결은 다시 동의하기 전까지 갱신 루프를 시작하지 않습니다. */
export async function markGoogleProviderReconsent(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, now: number): Promise<Receipt> {
  timestamp.parse(now);
  const context = command.parse({ owner, requestKey: `${current.id}:${current.generation}:provider-reconsent`, expectedVersion: current.version });
  return executeAtomic(db, context, "google.provider.reconsent", { now }, current.id, current.version + 1, requestId => [
    ...guardedUpdate(db, "google_runtime", owner.userId, current.id, current.version, requestId, 0, "state='reconsent'", [], "state IN ('active','partial') AND generation=?", [current.generation]),
    ...guardedUpdate(db, "google_connections", owner.userId, current.connectionId, current.connectionVersion, requestId, 1, "reconnect_required=1", [], "revoked_at IS NULL", []),
  ]);
}
