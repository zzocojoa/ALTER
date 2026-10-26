import { checkGoogleAcceptance } from "./google-acceptance-checks.ts";
import { checkGoogleTransportRuntime } from "./google-transport-runtime-checks.ts";
import { checkGoogleRefreshPreparation } from "./google-refresh-preparation-checks.ts";
import { checkGoogleKeyRotation } from "./google-key-rotation-checks.ts";
import { checkGoogleExecution } from "./google-execution-checks.ts";
import { checkGoogleResourceQuota } from "./google-resource-quota-checks.ts";
import { checkGoogleRefresh } from "./google-refresh-checks.ts";
import { recordId, siteIdentity } from "../../lib/domain/contracts.ts";
import { prepareGoogleOAuthAttempt } from "../../lib/google/oauth-state.ts";
import { consumeGoogleOAuthAttempt, saveGoogleOAuthAttempt } from "../../db/repositories/google-oauth.ts";
import { prepareGoogleConnectionWrite, readManagedGoogleConnection, readManagedGoogleToken, saveManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import { decryptGoogleTokenBundle, encryptGoogleTokenBundle, googleBase64Url } from "../../lib/google/token-crypto.ts";
import type { GoogleTokenKeyring } from "../../lib/google/token-crypto.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function rejected(run: () => Promise<unknown>, label: string): Promise<void> {
  try { await run(); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === "google_oauth_state_invalid") return; throw error; }
  throw new Error(label);
}
const googleWorker: Readonly<{ fetch: (request: Request, env: Readonly<{ DB: D1Database }>) => Promise<Response> }> = {
  async fetch(_request: Request, env: Readonly<{ DB: D1Database }>): Promise<Response> {
    const now: number = Date.parse("2026-10-25T00:00:00Z");
    const owner = siteIdentity.parse({ realm: "sites", userId: "owner" });
    const other = siteIdentity.parse({ realm: "sites", userId: "other" });
    const oauth = fixtureGoogleOAuth(now);
    const checks: string[] = [...await checkGoogleTransportRuntime(now), ...await checkGoogleAcceptance(env.DB)];
    const first = await prepareGoogleOAuthAttempt(owner, oauth, { kind: "connect" }, now);
    const wrong = await prepareGoogleOAuthAttempt(owner, oauth, { kind: "connect" }, now);
    await saveGoogleOAuthAttempt(env.DB, owner, first.attempt);
    const rows = await env.DB.prepare("SELECT * FROM google_oauth_attempts").all();
    for (const secret of [first.state, first.handle, first.nonce]) ensure(!JSON.stringify(rows).includes(secret), "비밀 원문이 저장됨");
    checks.push("state-handle-nonce-hashes-only");
    await rejected(() => consumeGoogleOAuthAttempt(env.DB, other, first.state, first.handle, oauth.callbackUrl, now), "다른 소유자 허용");
    await rejected(() => consumeGoogleOAuthAttempt(env.DB, owner, wrong.state, first.handle, oauth.callbackUrl, now), "다른 state 허용");
    await rejected(() => consumeGoogleOAuthAttempt(env.DB, owner, first.state, wrong.handle, oauth.callbackUrl, now), "다른 브라우저 핸들 허용");
    await rejected(() => consumeGoogleOAuthAttempt(env.DB, owner, first.state, first.handle, "https://other.test/api/google/oauth/callback", now), "다른 callback 허용");
    await rejected(() => consumeGoogleOAuthAttempt(env.DB, owner, first.state, first.handle, oauth.callbackUrl, now - 1), "생성 전 시각 허용");
    await rejected(() => consumeGoogleOAuthAttempt(env.DB, owner, first.state, first.handle, oauth.callbackUrl, now + 600_000), "만료 경계 허용");
    ensure((await env.DB.prepare("SELECT consumed_at FROM google_oauth_attempts WHERE id=?").bind(first.attempt.id).first<{ consumed_at: number | null }>())?.consumed_at === null, "실패한 검사가 시도 소비");
    checks.push("owner-browser-callback-expiry-zero-update-denied");
    const races = await Promise.allSettled(Array.from({ length: 12 }, () => consumeGoogleOAuthAttempt(env.DB, owner, first.state, first.handle, oauth.callbackUrl, now)));
    ensure(races.filter(result => result.status === "fulfilled").length === 1, "동시 callback 복수 교환권");
    ensure(races.filter(result => result.status === "rejected" && result.reason instanceof Error && "code" in result.reason && result.reason.code === "google_oauth_state_invalid").length === 11, "경쟁 실패 오분류");
    await rejected(() => consumeGoogleOAuthAttempt(env.DB, owner, first.state, first.handle, oauth.callbackUrl, now + 1), "소비한 state 재사용");
    checks.push("twelve-callbacks-one-consumer-no-replay");
    const reconnect = await prepareGoogleOAuthAttempt(owner, oauth, { kind: "reconnect", connectionId: recordId.parse("00000000-0000-4000-a000-000000001400"), generation: 4 }, now);
    await saveGoogleOAuthAttempt(env.DB, owner, reconnect.attempt);
    const consumed = await consumeGoogleOAuthAttempt(env.DB, owner, reconnect.state, reconnect.handle, oauth.callbackUrl, now);
    ensure(consumed.purpose.kind === "reconnect" && consumed.purpose.generation === 4, "재연결 세대 유실");
    checks.push("reconnect-generation-preserved");
    const keyring: GoogleTokenKeyring = { activeVersion: "test-v1", keys: [{ version: "test-v1", value: googleBase64Url(new Uint8Array(32).fill(1)) }] };
    const metadata = { subject: "real-fixture-google-sub", email: "google@example.test", scopes: [...googleRequestedScopes], accessExpiresAt: now + 3600_000, refreshExpiresAt: now + 604_800_000, authorizedAt: now };
    const plan = await prepareGoogleConnectionWrite(env.DB, owner, metadata.subject, { kind: "connect" });
    const token = await encryptGoogleTokenBundle({ accessToken: "access-fixture-secret", refreshToken: "refresh-fixture-secret", authorizedAt: now }, plan.binding, keyring);
    await saveManagedGoogleConnection(env.DB, plan, first.attempt.id, metadata, token);
    const connected = await readManagedGoogleConnection(env.DB, owner);
    ensure(connected !== null && connected.state === "active" && connected.generation === 1, "연결 저장 실패");
    if (connected === null) throw new Error("연결 없음");
    const storedToken = await readManagedGoogleToken(env.DB, owner, connected);
    ensure((await decryptGoogleTokenBundle(storedToken.token, plan.binding, keyring)).refreshToken === "refresh-fixture-secret", "암호화 토큰 복원 실패");
    const storedRows = await env.DB.batch([env.DB.prepare("SELECT * FROM google_connections"), env.DB.prepare("SELECT * FROM google_tokens"), env.DB.prepare("SELECT * FROM google_runtime"), env.DB.prepare("SELECT * FROM atomic_requests")]);
    ensure(!JSON.stringify(storedRows).includes("refresh-fixture-secret") && !JSON.stringify(storedRows).includes("access-fixture-secret"), "평문 토큰 DB 유출");
    checks.push("encrypted-token-connection-runtime-atomic-save");
    let implicitDenied: boolean = false;
    try { await prepareGoogleConnectionWrite(env.DB, owner, "different-sub", { kind: "connect" }); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === "google_account_replacement_denied") implicitDenied = true; else throw error; }
    ensure(implicitDenied, "묵시적 계정 교체 허용");
    checks.push("implicit-account-replacement-denied");
    const purpose = { kind: "reconnect" as const, connectionId: connected.connectionId, generation: connected.generation };
    const reconnects = await Promise.all(Array.from({ length: 2 }, async () => {
      const start = await prepareGoogleOAuthAttempt(owner, oauth, purpose, now);
      await saveGoogleOAuthAttempt(env.DB, owner, start.attempt);
      await consumeGoogleOAuthAttempt(env.DB, owner, start.state, start.handle, oauth.callbackUrl, now);
      const writePlan = await prepareGoogleConnectionWrite(env.DB, owner, metadata.subject, purpose);
      return { start, writePlan, encrypted: await encryptGoogleTokenBundle({ accessToken: "new-access-secret", refreshToken: "new-refresh-secret", authorizedAt: now }, writePlan.binding, keyring) };
    }));
    const saves = await Promise.allSettled(reconnects.map(item => saveManagedGoogleConnection(env.DB, item.writePlan, item.start.attempt.id, metadata, item.encrypted)));
    ensure(saves.filter(item => item.status === "fulfilled").length === 1, "동시 재연결 둘 다 저장");
    const second = await readManagedGoogleConnection(env.DB, owner);
    ensure(second !== null && second.generation === 2 && second.connectionId === connected.connectionId, "재연결 세대 또는 계정 오류");
    if (second === null) throw new Error("재연결 없음");
    let staleDenied: boolean = false;
    try { await readManagedGoogleToken(env.DB, owner, connected); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === "google_connection_unavailable") staleDenied = true; else throw error; }
    ensure(staleDenied, "오래된 연결 세대로 토큰 조회");
    checks.push("concurrent-reconnect-one-winner-stale-token-denied");
    const replacementPurpose = { kind: "reconnect" as const, connectionId: second.connectionId, generation: second.generation };
    const replacement = await prepareGoogleOAuthAttempt(owner, oauth, replacementPurpose, now);
    await saveGoogleOAuthAttempt(env.DB, owner, replacement.attempt); await consumeGoogleOAuthAttempt(env.DB, owner, replacement.state, replacement.handle, oauth.callbackUrl, now);
    const replacementPlan = await prepareGoogleConnectionWrite(env.DB, owner, "different-sub", replacementPurpose);
    const replacementToken = await encryptGoogleTokenBundle({ accessToken: "different-access", refreshToken: "different-refresh", authorizedAt: now }, replacementPlan.binding, keyring);
    await saveManagedGoogleConnection(env.DB, replacementPlan, replacement.attempt.id, { ...metadata, subject: "different-sub", email: "different@example.test", scopes: ["openid", "email"] }, replacementToken);
    const third = await readManagedGoogleConnection(env.DB, owner);
    ensure(third?.state === "partial" && third.generation === 3 && third.googleSubject === "different-sub", "부분 동의 또는 계정 전환 실패");
    ensure(await env.DB.prepare("SELECT id FROM google_tokens WHERE connection_id=?").bind(second.connectionId).first() === null, "이전 계정 토큰 잔존");
    ensure((await env.DB.prepare("SELECT revoked_at FROM google_connections WHERE id=?").bind(second.connectionId).first<{ revoked_at: number | null }>())?.revoked_at === now, "이전 계정 미철회");
    checks.push("explicit-new-sub-partial-scope-old-token-removed");
    return Response.json({ status: "passed", environment: "local-workerd-d1", checks: [...checks, ...await checkGoogleRefresh(env.DB), ...await checkGoogleResourceQuota(env.DB), ...await checkGoogleExecution(env.DB), ...await checkGoogleKeyRotation(env.DB), ...await checkGoogleRefreshPreparation(env.DB)] });
  },
};

export default googleWorker;
