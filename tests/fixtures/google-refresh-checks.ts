import { disconnectGoogle } from "../../lib/google/disconnect.ts";
import { beginGoogleDisconnect, finishGoogleDisconnect } from "../../db/repositories/google-disconnect.ts";
import { siteIdentity } from "../../lib/domain/contracts.ts";
import { prepareGoogleOAuthAttempt } from "../../lib/google/oauth-state.ts";
import { saveGoogleOAuthAttempt, consumeGoogleOAuthAttempt } from "../../db/repositories/google-oauth.ts";
import { prepareGoogleConnectionWrite, readManagedGoogleConnection, readManagedGoogleToken, saveManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import type { ManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import { claimGoogleRefresh, completeGoogleRefresh, expireGoogleRefreshLease } from "../../db/repositories/google-refresh.ts";
import { requireGoogleAccessToken } from "../../lib/google/access-token.ts";
import { decryptGoogleTokenBundle, encryptGoogleTokenBundle, googleBase64Url } from "../../lib/google/token-crypto.ts";
import type { GoogleTokenKeyring } from "../../lib/google/token-crypto.ts";
import type { GoogleOAuthRuntime } from "../../lib/google/oauth-exchange.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";
import { checkGoogleDisconnectRecovery } from "./google-disconnect-checks.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function fail(run: () => Promise<unknown>, code: string): Promise<void> {
  try { await run(); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === code) return; throw error; }
  throw new Error(`필수 실패 미발생: ${code}`);
}

export async function checkGoogleRefresh(db: D1Database): Promise<readonly string[]> {
  const now: number = Date.parse("2026-10-25T00:00:00Z");
  const owner = siteIdentity.parse({ realm: "sites", userId: "refresh-owner" });
  const oauth = { ...fixtureGoogleOAuth(now), ownerId: owner.userId };
  const keyring: GoogleTokenKeyring = { activeVersion: "test-v1", keys: [{ version: "test-v1", value: googleBase64Url(new Uint8Array(32).fill(2)) }] };
  const settings = { clientId: oauth.clientId, clientSecret: "fixture-client-secret", keyring };
  const checks: string[] = [];
  const reconnect = async (): Promise<ManagedGoogleConnection> => {
    const current = await readManagedGoogleConnection(db, owner);
    const purpose = current === null ? { kind: "connect" as const } : { kind: "reconnect" as const, connectionId: current.connectionId, generation: current.generation };
    const start = await prepareGoogleOAuthAttempt(owner, oauth, purpose, now); await saveGoogleOAuthAttempt(db, owner, start.attempt); await consumeGoogleOAuthAttempt(db, owner, start.state, start.handle, oauth.callbackUrl, now);
    const plan = await prepareGoogleConnectionWrite(db, owner, "refresh-subject", purpose);
    const token = await encryptGoogleTokenBundle({ accessToken: "old-access", refreshToken: "old-refresh", authorizedAt: now }, plan.binding, keyring);
    await saveManagedGoogleConnection(db, plan, start.attempt.id, { subject: "refresh-subject", email: "google@example.test", scopes: [...googleRequestedScopes], authorizedAt: now, accessExpiresAt: now + 1, refreshExpiresAt: now + 604_800_000 }, token);
    const saved = await readManagedGoogleConnection(db, owner); if (saved === null) throw new Error("갱신 시험 연결 없음"); return saved;
  };
  await reconnect(); let calls: number = 0;
  const success: GoogleOAuthRuntime = { now: () => now, wait: async () => {}, warn: () => {}, fetch: async (_url, init) => { calls += 1; ensure(new URLSearchParams(String(init.body)).get("refresh_token") === "old-refresh", "잘못된 refresh token"); return Response.json({ access_token: "new-access", expires_in: 3600, token_type: "Bearer", scope: googleRequestedScopes.join(" ") }); } };
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => requireGoogleAccessToken(db, owner, settings, success)));
  ensure(calls === 1 && results.some(result => result.status === "fulfilled"), "동시 갱신 중복 호출");
  const first = await readManagedGoogleConnection(db, owner); if (first === null) throw new Error("갱신 결과 없음");
  const encrypted = await readManagedGoogleToken(db, owner, first);
  const bundle = await decryptGoogleTokenBundle(encrypted.token, { ownerId: owner.userId, connectionId: first.connectionId, generation: first.generation }, keyring);
  ensure(bundle.refreshToken === "old-refresh" && bundle.accessToken === "new-access", "미반환 refresh token 유지 실패");
  ensure(first.refreshExpiresAt === now + 604_800_000, "Testing 만료 연장");
  checks.push("concurrent-refresh-one-network-call-preserves-refresh-token");
  await reconnect(); calls = 0;
  const unknown: GoogleOAuthRuntime = { ...success, fetch: async () => { calls += 1; throw new TypeError("response lost"); } };
  await fail(() => requireGoogleAccessToken(db, owner, settings, unknown), "google_oauth_transport_failed");
  ensure((await readManagedGoogleConnection(db, owner))?.state === "refresh-unknown", "응답 유실 상태 미보존");
  await fail(() => requireGoogleAccessToken(db, owner, settings, unknown), "google_connection_unavailable"); ensure(calls === 1, "결과 미확정 재전송");
  checks.push("lost-refresh-response-blocks-replay");
  await reconnect(); calls = 0;
  const invalid: GoogleOAuthRuntime = { ...success, fetch: async () => { calls += 1; return Response.json({ error: "invalid_grant" }, { status: 400 }); } };
  await fail(() => requireGoogleAccessToken(db, owner, settings, invalid), "google_oauth_transport_failed");
  ensure((await readManagedGoogleConnection(db, owner))?.state === "reconsent", "invalid_grant 재동의 누락");
  await fail(() => requireGoogleAccessToken(db, owner, settings, invalid), "google_connection_unavailable"); ensure(calls === 1, "invalid_grant 무한 갱신");
  checks.push("invalid-grant-reconsent-no-loop");
  const leaseStart = await reconnect(); const lease = await claimGoogleRefresh(db, owner, leaseStart, await readManagedGoogleToken(db, owner, leaseStart), crypto.randomUUID(), now);
  const token = await readManagedGoogleToken(db, owner, lease);
  await expireGoogleRefreshLease(db, owner, lease, now + 30_000);
  await fail(() => completeGoogleRefresh(db, owner, lease, { token: token.token, tokenVersion: token.tokenVersion, scopes: googleRequestedScopes, accessExpiresAt: now + 3600_000, refreshExpiresAt: now + 604_800_000, now: now + 30_001 }), "version_conflict");
  await fail(() => requireGoogleAccessToken(db, owner, settings, success), "google_connection_unavailable");
  checks.push("expired-lease-not-reclaimed-late-response-denied");
  await reconnect(); const expired: GoogleOAuthRuntime = { ...success, now: () => now + 604_800_000 };
  await fail(() => requireGoogleAccessToken(db, owner, settings, expired), "google_connection_unavailable");
  ensure((await readManagedGoogleConnection(db, owner))?.state === "reconsent", "Testing 7일 만료 미반영");
  checks.push("testing-seven-day-expiry-reconsent");
  const beforeDisconnect = await reconnect();
  const activeLease = await claimGoogleRefresh(db, owner, beforeDisconnect, await readManagedGoogleToken(db, owner, beforeDisconnect), crypto.randomUUID(), now);
  const activeToken = await readManagedGoogleToken(db, owner, activeLease);
  const pending = await beginGoogleDisconnect(db, owner, activeLease, crypto.randomUUID(), now);
  ensure(pending.generation === activeLease.generation + 1 && await db.prepare("SELECT id FROM google_tokens WHERE owner_id=?").bind(owner.userId).first() === null, "해제 시 토큰·세대 처리 실패");
  await fail(() => completeGoogleRefresh(db, owner, activeLease, { token: activeToken.token, tokenVersion: activeToken.tokenVersion, scopes: googleRequestedScopes, accessExpiresAt: now + 3600_000, refreshExpiresAt: now + 604_800_000, now }), "version_conflict");
  await fail(() => prepareGoogleConnectionWrite(db, owner, "refresh-subject", { kind: "reconnect", connectionId: pending.connectionId, generation: pending.generation }), "google_connection_unavailable");
  await fail(() => disconnectGoogle(db, owner, keyring, success, pending), "google_connection_unavailable");
  await finishGoogleDisconnect(db, owner, pending, "unknown");
  ensure((await readManagedGoogleConnection(db, owner))?.providerRevocation === "unknown", "제공사 미확정 상태 유실");
  checks.push("disconnect-invalidates-refresh-and-blocks-concurrent-reconnect");
  const beforeFailedRevoke = await reconnect(); calls = 0;
  const rejectedRevoke: GoogleOAuthRuntime = { ...success, fetch: async (url, options) => { calls += 1; ensure(url === "https://oauth2.googleapis.com/revoke" && String(options.body).includes("token=old-refresh"), "철회 엔드포인트 오류"); return Response.json({ error: "invalid_token" }, { status: 400 }); } };
  const disconnected = await disconnectGoogle(db, owner, keyring, rejectedRevoke, beforeFailedRevoke);
  ensure(disconnected.local === "disconnected" && disconnected.provider === "failed" && disconnected.status === 400 && calls === 1, "철회 실패와 로컬 해제 구분 실패");
  ensure(await db.prepare("SELECT id FROM google_tokens WHERE owner_id=?").bind(owner.userId).first() === null, "철회 실패 뒤 토큰 잔존");
  await fail(() => requireGoogleAccessToken(db, owner, settings, success), "google_connection_unavailable");
  checks.push("provider-revocation-failure-local-token-still-removed");
  const beforeSuccessRevoke = await reconnect();
  const revoked = await disconnectGoogle(db, owner, keyring, { ...success, fetch: async () => new Response(null, { status: 200 }) }, beforeSuccessRevoke);
  ensure(revoked.provider === "revoked" && (await readManagedGoogleConnection(db, owner))?.state === "disconnected", "정상 철회 저장 실패");
  checks.push("provider-revocation-success-disconnected");
  return [...checks, ...await checkGoogleDisconnectRecovery(db)];
}
