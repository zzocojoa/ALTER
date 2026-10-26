import { z } from "zod";
import { approvedScopes, command, encryptedToken, recordId, timestamp } from "../../lib/domain/contracts.ts";
import type { EncryptedToken, SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import { parseGoogleGrantedScopes } from "../../lib/google/permissions.ts";
import { executeAtomic, guardedUpdate, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { readManagedGoogleConnection } from "./google-managed.ts";
import type { ManagedGoogleConnection, StoredGoogleToken } from "./google-managed.ts";

/** 복호화한 원본 토큰과 연결 버전을 같은 batch에서 확인한 뒤 갱신 실행권을 발급합니다. */
export async function claimGoogleRefresh(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, source: StoredGoogleToken, leaseId: string, now: number): Promise<ManagedGoogleConnection> {
  recordId.parse(leaseId); timestamp.parse(now); encryptedToken.parse(source.token); z.number().int().positive().parse(source.tokenVersion);
  if (!["active", "partial"].includes(current.state) || current.refreshExpiresAt !== null && current.refreshExpiresAt <= now) throw googleFailure("google_connection_unavailable", "refresh-start-state");
  const context = command.parse({ owner, requestKey: leaseId, expectedVersion: current.version });
  await executeAtomic(db, context, "google.refresh.claim", { generation: current.generation, source, now }, current.id, current.version + 1, (requestId: string) => [
    requireInBatch(db, owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM google_connections c JOIN google_tokens t ON t.owner_id=c.owner_id AND t.connection_id=c.id WHERE c.owner_id=? AND c.id=? AND c.version=? AND c.revoked_at IS NULL AND c.reconnect_required=0 AND t.version=? AND t.key_version=? AND t.nonce=? AND t.ciphertext=?)", [owner.userId, current.connectionId, current.connectionVersion, source.tokenVersion, source.token.keyVersion, source.token.nonce, source.token.ciphertext]),
    ...guardedUpdate(db, "google_runtime", owner.userId, current.id, current.version, requestId, 1, "state='refreshing',refresh_lease_id=?,refresh_lease_expires_at=?", [leaseId, now + 30_000], "generation=? AND connection_id=? AND state IN ('active','partial') AND (refresh_expires_at IS NULL OR refresh_expires_at>?)", [current.generation, current.connectionId, now]),
  ]);
  const claimed: ManagedGoogleConnection | null = await readManagedGoogleConnection(db, owner);
  if (claimed === null || claimed.state !== "refreshing" || claimed.refreshLeaseId !== leaseId || claimed.generation !== current.generation || claimed.connectionId !== current.connectionId || claimed.connectionVersion !== current.connectionVersion || claimed.version !== current.version + 1) throw googleFailure("google_connection_unavailable", "refresh-claim-lost");
  return claimed;
}

export type GoogleRefreshCompletion = Readonly<{ token: EncryptedToken; tokenVersion: number; scopes: readonly string[]; accessExpiresAt: number; refreshExpiresAt: number | null; now: number }>;
export async function completeGoogleRefresh(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, value: GoogleRefreshCompletion): Promise<Receipt> {
  encryptedToken.parse(value.token); timestamp.parse(value.now); timestamp.parse(value.accessExpiresAt); z.number().int().positive().parse(value.tokenVersion);
  if (current.refreshLeaseId === null || current.state !== "refreshing" || value.accessExpiresAt <= value.now || value.refreshExpiresAt !== null && value.refreshExpiresAt <= value.now || current.refreshExpiresAt !== null && (value.refreshExpiresAt === null || value.refreshExpiresAt > current.refreshExpiresAt)) throw googleFailure("google_connection_unavailable", "refresh-complete-state");
  const scopes = parseGoogleGrantedScopes(value.scopes.join(" "));
  if (scopes.some(scope => !current.scopes.includes(scope))) throw googleFailure("google_scope_denied", "refresh-scope-expansion");
  const dataScopes = approvedScopes.filter(scope => scopes.includes(scope));
  const context = command.parse({ owner, requestKey: `${current.refreshLeaseId}:complete`, expectedVersion: current.version });
  return executeAtomic(db, context, "google.refresh.complete", value, current.id, current.version + 1, (requestId: string) => [
    ...guardedUpdate(db, "google_runtime", owner.userId, current.id, current.version, requestId, 0, "state=?,refresh_expires_at=?,refresh_lease_id=NULL,refresh_lease_expires_at=NULL", [dataScopes.length === approvedScopes.length ? "active" : "partial", value.refreshExpiresAt], "state='refreshing' AND generation=? AND connection_id=? AND refresh_lease_id=? AND refresh_lease_expires_at>?", [current.generation, current.connectionId, current.refreshLeaseId, value.now]),
    ...guardedUpdate(db, "google_connections", owner.userId, current.connectionId, current.connectionVersion, requestId, 1, "scopes=?,expires_at=?,reconnect_required=0", [JSON.stringify(dataScopes), value.accessExpiresAt], "revoked_at IS NULL", []),
    ...guardedUpdate(db, "google_tokens", owner.userId, current.connectionId, value.tokenVersion, requestId, 2, "ciphertext=?,nonce=?,key_version=?", [value.token.ciphertext, value.token.nonce, value.token.keyVersion], "connection_id=?", [current.connectionId]),
  ]);
}

/** 갱신 실패 상태는 토큰을 사용하지 못하게 막고 결과 미확정 요청을 자동 재전송하지 않습니다. */
export async function failGoogleRefresh(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, failure: "invalid-grant" | "unknown", now: number): Promise<Receipt> {
  timestamp.parse(now);
  if (current.state !== "refreshing" || current.refreshLeaseId === null) throw googleFailure("google_connection_unavailable", "refresh-failure-state");
  const context = command.parse({ owner, requestKey: `${current.refreshLeaseId}:${failure}`, expectedVersion: current.version });
  return executeAtomic(db, context, "google.refresh.failure", { failure, now }, current.id, current.version + 1, (requestId: string) => [
    ...guardedUpdate(db, "google_runtime", owner.userId, current.id, current.version, requestId, 0, "state=?,refresh_lease_id=NULL,refresh_lease_expires_at=NULL", [failure === "invalid-grant" ? "reconsent" : "refresh-unknown"], "state='refreshing' AND generation=? AND connection_id=? AND refresh_lease_id=?", [current.generation, current.connectionId, current.refreshLeaseId]),
    ...guardedUpdate(db, "google_connections", owner.userId, current.connectionId, current.connectionVersion, requestId, 1, "reconnect_required=1", [], "revoked_at IS NULL", []),
  ]);
}

/** 임대 만료는 이전 요청의 미실행 증거가 아니므로 새 갱신권을 발급하지 않습니다. */
export async function expireGoogleRefreshLease(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, now: number): Promise<Receipt> {
  timestamp.parse(now);
  if (current.state !== "refreshing" || current.refreshLeaseExpiresAt === null || current.refreshLeaseExpiresAt > now) throw googleFailure("google_connection_unavailable", "refresh-lease-not-expired");
  return failGoogleRefresh(db, owner, current, "unknown", now);
}

export async function expireGoogleAuthorization(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, now: number): Promise<Receipt> {
  timestamp.parse(now);
  if (!["active", "partial"].includes(current.state) || current.refreshExpiresAt === null || current.refreshExpiresAt > now) throw googleFailure("google_connection_unavailable", "authorization-not-expired");
  const context = command.parse({ owner, requestKey: `${current.id}:${current.generation}:expired`, expectedVersion: current.version });
  return executeAtomic(db, context, "google.authorization.expire", { now }, current.id, current.version + 1, (requestId: string) => [
    ...guardedUpdate(db, "google_runtime", owner.userId, current.id, current.version, requestId, 0, "state='reconsent'", [], "state IN ('active','partial') AND generation=? AND refresh_expires_at<=?", [current.generation, now]),
    ...guardedUpdate(db, "google_connections", owner.userId, current.connectionId, current.connectionVersion, requestId, 1, "reconnect_required=1", [], "revoked_at IS NULL", []),
  ]);
}
