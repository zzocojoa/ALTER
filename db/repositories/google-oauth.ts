import { z } from "zod";
import { recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import { googleCallbackHashes, oauthPurpose } from "../../lib/google/oauth-state.ts";
import type { OAuthAttempt, OAuthPurpose } from "../../lib/google/oauth-state.ts";

const attemptInput = z.object({ id: recordId, ownerId: z.string().min(1).max(200), stateHash: z.string().regex(/^[a-f0-9]{64}$/), handleHash: z.string().regex(/^[a-f0-9]{64}$/), nonceHash: z.string().regex(/^[a-f0-9]{64}$/), callbackUrl: z.string().url(), purpose: oauthPurpose, createdAt: timestamp, expiresAt: timestamp }).strict().refine((value): boolean => value.expiresAt > value.createdAt && value.expiresAt - value.createdAt <= 600_000);
const consumedRow = z.object({ id: recordId, nonceHash: z.string().regex(/^[a-f0-9]{64}$/), callbackUrl: z.string().url(), purpose: z.enum(["connect", "reconnect"]), connectionId: recordId.nullable(), connectionGeneration: z.number().int().positive().nullable() }).strict();
export type ConsumedGoogleAttempt = Readonly<{ id: string; nonceHash: string; callbackUrl: string; purpose: OAuthPurpose }>;

/** 응답 유실 시 재삽입하지 않으며 브라우저에는 저장 성공을 확인한 시도만 전달합니다. */
export async function saveGoogleOAuthAttempt(db: D1Database, owner: SiteIdentity, value: OAuthAttempt): Promise<void> {
  siteIdentity.parse(owner); const attempt: OAuthAttempt = attemptInput.parse(value);
  if (attempt.ownerId !== owner.userId) throw googleFailure("google_oauth_state_invalid", "oauth-start-owner");
  let result: D1Result;
  try { result = await db.prepare("INSERT INTO google_oauth_attempts (owner_id,id,state_hash,handle_hash,nonce_hash,callback_url,purpose,connection_id,connection_generation,created_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)").bind(owner.userId, attempt.id, attempt.stateHash, attempt.handleHash, attempt.nonceHash, attempt.callbackUrl, attempt.purpose.kind, attempt.purpose.kind === "reconnect" ? attempt.purpose.connectionId : null, attempt.purpose.kind === "reconnect" ? attempt.purpose.generation : null, attempt.createdAt, attempt.expiresAt).run(); }
  catch (error: unknown) { throw Object.assign(googleFailure("google_oauth_state_unknown", "oauth-start-storage"), { cause: error }); }
  if (!result.success || result.meta.changes !== 1) throw googleFailure("google_oauth_state_unknown", "oauth-start-storage");
}

/** 일반 명령 영수증의 재사용을 적용하지 않고 한 조건부 UPDATE만 code 교환권을 얻습니다. */
export async function consumeGoogleOAuthAttempt(db: D1Database, owner: SiteIdentity, state: string, handle: string, callbackUrl: string, now: number): Promise<ConsumedGoogleAttempt> {
  siteIdentity.parse(owner); timestamp.parse(now);
  const hashes = await googleCallbackHashes(state, handle);
  let result: D1Result;
  try { result = await db.prepare("UPDATE google_oauth_attempts SET consumed_at=? WHERE owner_id=? AND state_hash=? AND handle_hash=? AND callback_url=? AND consumed_at IS NULL AND created_at<=? AND expires_at>? RETURNING id,nonce_hash AS nonceHash,callback_url AS callbackUrl,purpose,connection_id AS connectionId,connection_generation AS connectionGeneration").bind(now, owner.userId, hashes.stateHash, hashes.handleHash, callbackUrl, now, now).all(); }
  catch (error: unknown) { throw Object.assign(googleFailure("google_oauth_state_unknown", "oauth-consume-storage"), { cause: error }); }
  if (!result.success) throw googleFailure("google_oauth_state_unknown", "oauth-consume-storage");
  if (result.meta.changes !== 1 || result.results.length !== 1) throw googleFailure("google_oauth_state_invalid", "oauth-consume");
  const row = consumedRow.parse(result.results[0]);
  const purpose: OAuthPurpose = row.purpose === "connect" ? { kind: "connect" } : oauthPurpose.parse({ kind: "reconnect", connectionId: row.connectionId, generation: row.connectionGeneration });
  return { id: row.id, nonceHash: row.nonceHash, callbackUrl: row.callbackUrl, purpose };
}
