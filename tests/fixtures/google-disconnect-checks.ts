import { beginGoogleDisconnect, finishGoogleDisconnect, recoverGoogleDisconnect } from "../../db/repositories/google-disconnect.ts";
import { prepareGoogleConnectionWrite, readManagedGoogleConnection, readManagedGoogleToken, saveManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import { consumeGoogleOAuthAttempt, saveGoogleOAuthAttempt } from "../../db/repositories/google-oauth.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { disconnectGoogle } from "../../lib/google/disconnect.ts";
import { googleDisconnectRecoveryDelayMs } from "../../lib/google/disconnect-policy.ts";
import { prepareGoogleOAuthAttempt } from "../../lib/google/oauth-state.ts";
import type { GoogleOAuthRuntime } from "../../lib/google/oauth-exchange.ts";
import { encryptGoogleTokenBundle } from "../../lib/google/token-crypto.ts";
import type { GoogleTokenKeyring } from "../../lib/google/token-crypto.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";
import { fixtureGoogleConnection } from "./google-connected.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function fail(run: () => Promise<unknown>, code: string): Promise<void> {
  try { await run(); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === code) return; throw error; }
  throw new Error(`해제 복구의 필수 거부 누락: ${code}`);
}
async function reconnect(db: D1Database, owner: SiteIdentity, keyring: GoogleTokenKeyring, now: number): Promise<void> {
  const current = await readManagedGoogleConnection(db, owner);
  if (current === null) throw new Error("해제 복구 시험의 기존 연결 없음");
  const purpose = { kind: "reconnect" as const, connectionId: current.connectionId, generation: current.generation };
  const oauth = { ...fixtureGoogleOAuth(now), ownerId: owner.userId };
  const start = await prepareGoogleOAuthAttempt(owner, oauth, purpose, now);
  await saveGoogleOAuthAttempt(db, owner, start.attempt);
  await consumeGoogleOAuthAttempt(db, owner, start.state, start.handle, oauth.callbackUrl, now);
  const plan = await prepareGoogleConnectionWrite(db, owner, current.googleSubject, purpose);
  const token = await encryptGoogleTokenBundle({ accessToken: "reconnected-fixture-access", refreshToken: "reconnected-fixture-refresh", authorizedAt: now }, plan.binding, keyring);
  await saveManagedGoogleConnection(db, plan, start.attempt.id, { subject: current.googleSubject, email: "fixture@example.test", scopes: [...googleRequestedScopes], accessExpiresAt: now + 3_600_000, refreshExpiresAt: now + 604_800_000, authorizedAt: now }, token);
}

/** 실제 네트워크 없이 중단·동시 복구·늦은 철회 완료가 기존 또는 새 연결을 손상하지 않는지 검사합니다. */
export async function checkGoogleDisconnectRecovery(db: D1Database): Promise<readonly string[]> {
  const now: number = Date.parse("2026-10-25T00:00:00Z");
  const checks: string[] = [];
  const fixture = await fixtureGoogleConnection(db, "disconnect-recovery-owner", now);
  const pending = await beginGoogleDisconnect(db, fixture.owner, fixture.connection, crypto.randomUUID(), now);
  let networkCalls: number = 0;
  const forbidden: GoogleOAuthRuntime = { now: () => now + googleDisconnectRecoveryDelayMs, wait: async () => {}, warn: () => {}, fetch: async () => { networkCalls += 1; throw new Error("해제 복구는 제공사를 호출할 수 없습니다."); } };
  for (const at of [now - 1, now + googleDisconnectRecoveryDelayMs - 1]) {
    await fail(() => disconnectGoogle(db, fixture.owner, null, { ...forbidden, now: () => at }, pending), "google_connection_unavailable");
  }
  await fail(() => disconnectGoogle(db, { realm: "sites", userId: "other-disconnect-owner" }, null, forbidden, pending), "google_connection_unavailable");
  ensure((await readManagedGoogleConnection(db, fixture.owner))?.version === pending.version && networkCalls === 0, "유예 전 또는 다른 소유자 해제 복구 허용");
  checks.push("disconnect-recovery-owner-and-grace-boundary");

  const outcomes = await Promise.all([0, 1].map(() => disconnectGoogle(db, fixture.owner, null, forbidden, pending)));
  const recovered = await readManagedGoogleConnection(db, fixture.owner);
  ensure(outcomes.every(result => result.local === "disconnected" && result.provider === "unknown") && recovered?.version === pending.version + 1 && recovered.state === "disconnected" && recovered.providerRevocation === "unknown", "동시 해제 복구 중복 갱신 또는 철회 확정 오류");
  ensure(await db.prepare("SELECT count(*) AS n FROM atomic_requests WHERE owner_id=? AND scope='google.disconnect.recover'").bind(fixture.owner.userId).first<number>("n") === 1, "해제 복구 영수증 중복");
  ensure(await db.prepare("SELECT count(*) AS n FROM google_tokens WHERE owner_id=?").bind(fixture.owner.userId).first<number>("n") === 0 && networkCalls === 0, "해제 복구가 토큰 또는 제공사 호출을 복원함");
  await disconnectGoogle(db, fixture.owner, null, forbidden, pending);
  ensure((await readManagedGoogleConnection(db, fixture.owner))?.version === recovered?.version, "완료된 해제 재시도의 중복 갱신");
  checks.push("interrupted-disconnect-recovery-cas-idempotent-without-token-or-network");

  await reconnect(db, fixture.owner, fixture.keyring, now + googleDisconnectRecoveryDelayMs);
  const next = await readManagedGoogleConnection(db, fixture.owner);
  if (next === null) throw new Error("해제 복구 이후 재연결 없음");
  const nextToken = await readManagedGoogleToken(db, fixture.owner, next);
  await fail(() => finishGoogleDisconnect(db, fixture.owner, pending, "revoked"), "version_conflict");
  await fail(() => recoverGoogleDisconnect(db, fixture.owner, pending, now + googleDisconnectRecoveryDelayMs), "google_connection_unavailable");
  await fail(() => disconnectGoogle(db, fixture.owner, null, forbidden, pending), "google_connection_unavailable");
  ensure(JSON.stringify(await readManagedGoogleConnection(db, fixture.owner)) === JSON.stringify(next) && JSON.stringify(await readManagedGoogleToken(db, fixture.owner, next)) === JSON.stringify(nextToken), "이전 해제 실행이 새 연결 또는 토큰을 변경함");
  checks.push("recovered-disconnect-reconnects-and-fences-late-old-generation");

  const live = await fixtureGoogleConnection(db, "disconnect-live-owner", now);
  const entered: PromiseWithResolvers<void> = Promise.withResolvers<void>();
  const response: PromiseWithResolvers<Response> = Promise.withResolvers<Response>();
  const liveRuntime: GoogleOAuthRuntime = { ...forbidden, now: () => now, fetch: async () => { networkCalls += 1; entered.resolve(); return response.promise; } };
  const running = disconnectGoogle(db, live.owner, live.keyring, liveRuntime, live.connection);
  await entered.promise;
  const livePending = await readManagedGoogleConnection(db, live.owner);
  if (livePending === null) throw new Error("진행 중인 철회 연결 없음");
  try {
    await fail(() => disconnectGoogle(db, live.owner, null, { ...forbidden, now: () => now + googleDisconnectRecoveryDelayMs - 1 }, livePending), "google_connection_unavailable");
    await fail(() => prepareGoogleConnectionWrite(db, live.owner, livePending.googleSubject, { kind: "reconnect", connectionId: livePending.connectionId, generation: livePending.generation }), "google_connection_unavailable");
  } finally { response.resolve(new Response(null, { status: 200 })); }
  ensure((await running).provider === "revoked" && networkCalls === 1, "진행 중인 철회가 중복되거나 차단된 복구가 철회 결과를 변경함");
  checks.push("live-revocation-blocks-recovery-and-reconnect");

  const expired = await fixtureGoogleConnection(db, "disconnect-expired-dispatch-owner", now);
  let clock: number = now;
  let expiredCalls: number = 0;
  const expiredRuntime: GoogleOAuthRuntime = { now: () => clock, warn: () => {}, wait: async () => { clock = now + googleDisconnectRecoveryDelayMs; }, fetch: async () => { expiredCalls += 1; return new Response(null, { status: 503 }); } };
  const expiredResult = await disconnectGoogle(db, expired.owner, expired.keyring, expiredRuntime, expired.connection);
  ensure(expiredCalls === 1 && expiredResult.provider === "unknown" && (await readManagedGoogleConnection(db, expired.owner))?.state === "disconnected", "기한이 지난 실행이 제공사 철회를 다시 전송함");
  checks.push("expired-revocation-retry-stops-before-provider-dispatch");

  const late = await fixtureGoogleConnection(db, "disconnect-late-finish-owner", now);
  const lateEntered: PromiseWithResolvers<void> = Promise.withResolvers<void>();
  const lateResponse: PromiseWithResolvers<Response> = Promise.withResolvers<Response>();
  const lateRunning = disconnectGoogle(db, late.owner, late.keyring, { ...liveRuntime, fetch: async () => { lateEntered.resolve(); return lateResponse.promise; } }, late.connection);
  const lateOutcome: Promise<unknown> = lateRunning.then(value => value, (error: unknown) => error);
  await lateEntered.promise;
  const latePending = await readManagedGoogleConnection(db, late.owner);
  if (latePending === null) throw new Error("늦은 응답 시험의 연결 없음");
  await disconnectGoogle(db, late.owner, null, forbidden, latePending);
  await reconnect(db, late.owner, late.keyring, now + googleDisconnectRecoveryDelayMs);
  const afterReconnect = await readManagedGoogleConnection(db, late.owner);
  lateResponse.resolve(new Response(null, { status: 200 }));
  const lateError: unknown = await lateOutcome;
  ensure(lateError instanceof Error && "code" in lateError && lateError.code === "version_conflict" && JSON.stringify(await readManagedGoogleConnection(db, late.owner)) === JSON.stringify(afterReconnect), "늦은 철회 성공 응답이 새 연결을 종료함");
  checks.push("late-revocation-response-cannot-finish-new-connection");
  return checks;
}
