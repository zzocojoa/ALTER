import { command, encryptedToken, timestamp, version } from "../../lib/domain/contracts.ts";
import type { EncryptedToken, SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import { executeAtomic, guardedUpdate, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import type { ManagedGoogleConnection, StoredGoogleToken } from "./google-managed.ts";

/** 연결·세대·원본 암호문을 함께 비교하여 키 교체가 갱신·해제·재연결 결과를 덮어쓰지 못하게 합니다. */
export async function rotateManagedGoogleTokenKey(db: D1Database, owner: SiteIdentity, current: ManagedGoogleConnection, source: StoredGoogleToken, target: EncryptedToken, now: number): Promise<Receipt> {
  encryptedToken.parse(source.token); encryptedToken.parse(target); version.parse(source.tokenVersion); timestamp.parse(now);
  if (!["active", "partial"].includes(current.state) || current.accessExpiresAt <= now || current.refreshExpiresAt !== null && current.refreshExpiresAt <= now) throw googleFailure("google_connection_unavailable", "token-key-rotation-state");
  if (source.token.keyVersion === target.keyVersion || source.token.nonce === target.nonce) throw googleFailure("google_token_integrity_invalid", "token-key-rotation-target");
  const context = command.parse({ owner, requestKey: crypto.randomUUID(), expectedVersion: current.version });
  return executeAtomic(db, context, "google.token-key.rotate", { generation: current.generation, source, target, now }, current.id, current.version + 1, (requestId: string) => [
    requireInBatch(db, owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM google_connections WHERE owner_id=? AND id=? AND version=? AND revoked_at IS NULL AND reconnect_required=0 AND expires_at>?)", [owner.userId, current.connectionId, current.connectionVersion, now]),
    ...guardedUpdate(db, "google_runtime", owner.userId, current.id, current.version, requestId, 1, "state=?", [current.state], "connection_id=? AND generation=? AND state=? AND state IN ('active','partial') AND (refresh_expires_at IS NULL OR refresh_expires_at>?)", [current.connectionId, current.generation, current.state, now]),
    ...guardedUpdate(db, "google_tokens", owner.userId, current.connectionId, source.tokenVersion, requestId, 2, "ciphertext=?,nonce=?,key_version=?", [target.ciphertext, target.nonce, target.keyVersion], "connection_id=? AND key_version=? AND nonce=? AND ciphertext=?", [current.connectionId, source.token.keyVersion, source.token.nonce, source.token.ciphertext]),
  ]);
}
