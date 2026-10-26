import { command, encryptedToken, timestamp, version } from "../../lib/domain/contracts.ts";
import type { EncryptedToken, SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import { googleDisconnectRecoveryDelayMs } from "../../lib/google/disconnect-policy.ts";
import { executeAtomic, guardedUpdate, readStorage } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { readManagedGoogleConnection } from "./google-managed.ts";
import type { ManagedGoogleConnection } from "./google-managed.ts";

/** 결과 미확정·재동의 상태에서도 제공사 철회에만 쓸 암호문을 읽습니다. */
export async function readGoogleRevocationToken(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection): Promise<EncryptedToken> {
  const row = await readStorage("google.revocation.token", () => db.prepare("SELECT t.algorithm,t.ciphertext,t.nonce,t.key_version AS keyVersion FROM google_tokens t JOIN google_runtime r ON r.owner_id=t.owner_id AND r.connection_id=t.connection_id WHERE r.owner_id=? AND r.id=? AND r.version=? AND r.generation=? AND r.state NOT IN ('disconnecting','disconnected')").bind(owner.userId, current.id, current.version, current.generation).first());
  if (row === null) throw googleFailure("google_connection_unavailable", "revocation-token-missing");
  return encryptedToken.parse(row);
}

/** 먼저 세대를 바꾸고 로컬 토큰을 제거해 진행 중인 갱신 결과가 연결을 복원하지 못하게 합니다. */
export async function beginGoogleDisconnect(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, requestKey: string, now: number): Promise<ManagedGoogleConnection> {
  timestamp.parse(now); const generation: number = version.parse(current.generation + 1);
  const context = command.parse({ owner, requestKey, expectedVersion: current.version });
  await executeAtomic(db, context, "google.disconnect.begin", { now, generation }, current.id, current.version + 1, (requestId: string) => [
    ...guardedUpdate(db, "google_runtime", owner.userId, current.id, current.version, requestId, 0, "generation=?,state='disconnecting',refresh_lease_id=NULL,refresh_lease_expires_at=NULL,storage_evidence=NULL,provider_revocation='pending'", [generation], "generation=? AND connection_id=? AND state NOT IN ('disconnecting','disconnected')", [current.generation, current.connectionId]),
    ...guardedUpdate(db, "google_connections", owner.userId, current.connectionId, current.connectionVersion, requestId, 1, "revoked_at=?,reconnect_required=1", [now], "1", []),
    db.prepare("DELETE FROM google_picker_leases WHERE owner_id=?").bind(owner.userId),
    db.prepare("DELETE FROM google_resources WHERE owner_id=?").bind(owner.userId),
    db.prepare("DELETE FROM google_tokens WHERE owner_id=? AND connection_id=?").bind(owner.userId, current.connectionId),
  ]);
  const state = await readManagedGoogleConnection(db, owner);
  if (state === null || state.state !== "disconnecting" || state.generation !== generation) throw googleFailure("google_connection_unavailable", "disconnect-generation");
  return state;
}
export async function finishGoogleDisconnect(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, provider: "revoked" | "failed" | "unknown"): Promise<Receipt> {
  const context = command.parse({ owner, requestKey: `${current.id}:${current.generation}:disconnect-finish`, expectedVersion: current.version });
  return executeAtomic(db, context, "google.disconnect.finish", { provider }, current.id, current.version + 1, (requestId: string) => guardedUpdate(db, "google_runtime", owner.userId, current.id, current.version, requestId, 0, "state='disconnected',provider_revocation=?", [provider], "generation=? AND state='disconnecting'", [current.generation]));
}

/** 해제 시작과 같은 batch에서 저장한 시각만 읽으며 다른 세대의 연결을 대상으로 하지 않습니다. */
export async function readGoogleDisconnectStartedAt(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection): Promise<number> {
  const startedAt: number | null = await readStorage("google.disconnect.started", () => db.prepare("SELECT c.revoked_at FROM google_connections c JOIN google_runtime r ON r.owner_id=c.owner_id AND r.connection_id=c.id WHERE r.owner_id=? AND r.id=? AND r.version=? AND r.generation=? AND r.connection_id=? AND r.state='disconnecting' AND r.provider_revocation='pending' AND c.version=?").bind(owner.userId, current.id, current.version, current.generation, current.connectionId, current.connectionVersion).first<number>("revoked_at"));
  if (startedAt === null) throw googleFailure("google_connection_unavailable", "disconnect-attempt-changed");
  return timestamp.parse(startedAt);
}

/** 만료된 해제의 동일 세대만 닫으며 이미 삭제한 토큰이나 제공사 호출을 복구하지 않습니다. */
export async function recoverGoogleDisconnect(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, now: number): Promise<Receipt> {
  timestamp.parse(now);
  const startedAt: number = await readGoogleDisconnectStartedAt(db, owner, current);
  if (now - startedAt < googleDisconnectRecoveryDelayMs) throw googleFailure("google_connection_unavailable", "disconnect-still-running");
  const context = command.parse({ owner, requestKey: `${current.id}:${current.generation}:disconnect-recover`, expectedVersion: current.version });
  return executeAtomic(db, context, "google.disconnect.recover", { generation: current.generation, startedAt }, current.id, current.version + 1, (requestId: string) => guardedUpdate(db, "google_runtime", owner.userId, current.id, current.version, requestId, 0, "state='disconnected',provider_revocation='unknown'", [], "connection_id=? AND generation=? AND state='disconnecting' AND provider_revocation='pending' AND EXISTS(SELECT 1 FROM google_connections c WHERE c.owner_id=? AND c.id=? AND c.version=? AND c.revoked_at=? AND c.revoked_at<=?) AND NOT EXISTS(SELECT 1 FROM google_tokens t WHERE t.owner_id=? AND t.connection_id=?)", [current.connectionId, current.generation, owner.userId, current.connectionId, current.connectionVersion, startedAt, now - googleDisconnectRecoveryDelayMs, owner.userId, current.connectionId]));
}
