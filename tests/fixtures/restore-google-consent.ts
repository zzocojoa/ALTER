import { checkRestoreReconciliation } from "./restore-reconciliation-checks.ts";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { readRestoredExecution, requireCurrentExecutionAuthority } from "../../db/repositories/restore-execution.ts";
import { consumeGoogleOAuthAttempt, saveGoogleOAuthAttempt } from "../../db/repositories/google-oauth.ts";
import { prepareGoogleConnectionWrite, readManagedGoogleConnection, readManagedGoogleToken, saveManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import { exchangeGoogleCode } from "../../lib/google/oauth-exchange.ts";
import type { GoogleOAuthRuntime } from "../../lib/google/oauth-exchange.ts";
import { googleAuthorizationUrl, prepareGoogleOAuthAttempt } from "../../lib/google/oauth-state.ts";
import { decryptGoogleTokenBundle, encryptGoogleTokenBundle, googleBase64Url } from "../../lib/google/token-crypto.ts";
import type { GoogleTokenKeyring } from "../../lib/google/token-crypto.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";

function ensure(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
async function refused(action: () => Promise<unknown>, code: string): Promise<void> {
  try { await action(); }
  catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === code) return; throw error; }
  throw new Error(`예상한 거부가 발생하지 않음: ${code}`);
}
async function executionSnapshot(db: D1Database, owner: SiteIdentity): Promise<string> {
  const tables: readonly string[] = ["cost_windows", "cost_reservations", "cost_usage", "ai_calls", "ai_funding_checks", "ai_cost_intents", "external_jobs", "external_steps", "external_attempts", "external_workflows", "external_operations", "external_attempt_records", "google_requests", "google_quota_charges", "google_quota_policies", "quota_windows", "quota_reservations"];
  const results = await db.batch(tables.map(table => db.prepare(`SELECT * FROM ${table} WHERE owner_id=? ORDER BY rowid`).bind(owner.userId)));
  return JSON.stringify(results.map(result => result.results));
}

/** 실제 복원 D1에서 새 동의와 서명 검증을 거치되 외부 제공사 응답만 모의로 제공합니다. */
export async function checkRestoreGoogleConsent(db: D1Database, owner: SiteIdentity, now: number): Promise<Readonly<{ checks: readonly string[]; mockedOAuthRequests: number; liveProviderRequests: number }>> {
  ensure((await readRestoredExecution(db, owner))?.learning === "active", "학습 활성화 전 동의 검증");
  ensure(await readManagedGoogleConnection(db, owner) === null, "복원 토큰 없는 자동 연결");
  for (const table of ["google_runtime", "google_tokens", "google_oauth_attempts"]) ensure(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<number>("n") === 0, "이전 인증 정보 승계");
  const historical = await db.prepare("SELECT id,google_subject AS subject,reconnect_required,expires_at FROM google_connections WHERE owner_id=? LIMIT 1").bind(owner.userId).first<{ id: string; subject: string; reconnect_required: number; expires_at: number }>();
  if (historical === null) throw new Error("복원된 Google 연결 이력 없음");
  ensure(historical.reconnect_required === 1 && historical.expires_at === 0, "과거 연결이 활성 상태로 복원됨");
  const before: string = await executionSnapshot(db, owner);
  await refused(() => requireCurrentExecutionAuthority(db, owner), "restore_execution_unverified");
  const origin: string = "https://restore.example.test";
  const oauth = { ...fixtureGoogleOAuth(now), ownerId: owner.userId, origin, callbackUrl: `${origin}/api/google/oauth/callback`, registeredOrigins: [origin], registeredCallbacks: [`${origin}/api/google/oauth/callback`] };
  const start = await prepareGoogleOAuthAttempt(owner, oauth, { kind: "connect" }, now);
  const authorization = new URL(googleAuthorizationUrl(oauth, start));
  ensure(authorization.searchParams.get("prompt") === "consent select_account" && authorization.searchParams.get("scope") === googleRequestedScopes.join(" "), "새 동의나 최소 범위 누락");
  await saveGoogleOAuthAttempt(db, owner, start.attempt);
  await refused(() => consumeGoogleOAuthAttempt(db, { realm: "sites", userId: "unverified-owner" }, start.state, start.handle, oauth.callbackUrl, now), "google_oauth_state_invalid");
  const consumed = await consumeGoogleOAuthAttempt(db, owner, start.state, start.handle, oauth.callbackUrl, now);
  await refused(() => consumeGoogleOAuthAttempt(db, owner, start.state, start.handle, oauth.callbackUrl, now), "google_oauth_state_invalid");
  const keys = await generateKeyPair("RS256", { extractable: true }); const key = await exportJWK(keys.publicKey);
  const token: string = await new SignJWT({ iss: "https://accounts.google.com", aud: oauth.clientId, sub: historical.subject, email: "google@example.test", email_verified: true, nonce: start.nonce, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600 }).setProtectedHeader({ alg: "RS256", kid: "restore-test-key" }).sign(keys.privateKey);
  const calls: string[] = [];
  const runtime: GoogleOAuthRuntime = { now: () => now, wait: async () => { throw new Error("예상하지 않은 OAuth 재시도"); }, warn: () => { throw new Error("예상하지 않은 OAuth 경고"); }, fetch: async (url, init) => {
    const request: Request = new Request(url, init); calls.push(url);
    if (url === "https://www.googleapis.com/oauth2/v3/certs" && request.method === "GET") return Response.json({ keys: [{ kty: key.kty, n: key.n, e: key.e, kid: "restore-test-key", use: "sig", alg: "RS256" }] });
    if (url !== "https://oauth2.googleapis.com/token" || request.method !== "POST") throw new Error("허용하지 않은 모의 제공사 요청");
    const params = new URLSearchParams(await request.text());
    ensure(params.get("code") === "fresh-restore-code" && params.get("redirect_uri") === oauth.callbackUrl, "새 복원 동의 코드·복귀 주소 불일치");
    return Response.json({ access_token: "fresh-restore-access", refresh_token: "fresh-restore-refresh", token_type: "Bearer", expires_in: 3600, id_token: token, scope: googleRequestedScopes.join(" ") });
  } };
  const candidate = await exchangeGoogleCode(runtime, oauth, consumed, "fresh-restore-code", "fixture-client-secret", null);
  const plan = await prepareGoogleConnectionWrite(db, owner, candidate.identity.subject, consumed.purpose);
  ensure(plan.binding.ownerId === owner.userId && plan.binding.connectionId === historical.id && plan.binding.generation === 1, "새 인증이 복원 소유자·기존 외부 참조와 연결되지 않음");
  const keyring: GoogleTokenKeyring = { activeVersion: "restore-test", keys: [{ version: "restore-test", value: googleBase64Url(crypto.getRandomValues(new Uint8Array(32))) }] };
  const encrypted = await encryptGoogleTokenBundle({ accessToken: candidate.accessToken, refreshToken: candidate.refreshToken, authorizedAt: candidate.authorizedAt }, plan.binding, keyring);
  await saveManagedGoogleConnection(db, plan, consumed.id, { subject: candidate.identity.subject, email: candidate.identity.email, scopes: [...candidate.scopes], accessExpiresAt: candidate.accessExpiresAt, refreshExpiresAt: candidate.refreshExpiresAt, authorizedAt: candidate.authorizedAt }, encrypted);
  const connection = await readManagedGoogleConnection(db, owner);
  if (connection === null) throw new Error("새 인증 저장 누락");
  ensure(connection.connectionId === historical.id && connection.state === "active", "재동의가 다른 연결 참조를 생성함");
  const stored = await readManagedGoogleToken(db, owner, connection);
  const fresh = await decryptGoogleTokenBundle(stored.token, plan.binding, keyring);
  ensure(fresh.accessToken === "fresh-restore-access" && fresh.refreshToken === "fresh-restore-refresh", "새 동의 토큰 저장 불일치");
  await refused(() => requireCurrentExecutionAuthority(db, owner), "restore_execution_unverified");
  ensure(await executionSnapshot(db, owner) === before, "재동의가 과거 비용·예약·외부 작업을 변경함");
  ensure(calls.length === 2, "인증 이외 자동 제공사 요청");
  const approvedAt = await db.prepare("SELECT max(approved_at) AS n FROM google_resources WHERE owner_id=?").bind(owner.userId).first<number | null>("n");
  const reconciliation = await checkRestoreReconciliation(db, owner, keyring, Math.max(now + 1, (approvedAt ?? 0) + 1));
  ensure(await executionSnapshot(db, owner) === before, "대조가 과거 비용·예약·작업을 변경함");
  return { checks: [...reconciliation, "restored Google starts disconnected without tokens/runtime; fresh state is owner-bound and single-use; signed identity and original minimal scopes verified", "explicit fresh consent preserves historical Google connection ID; new encrypted tokens bind to confirmed target owner; budget/reservations/jobs unchanged and ordinary execution remains blocked"], mockedOAuthRequests: calls.length, liveProviderRequests: 0 };
}
