import { requireGoogleAccessToken } from "../../lib/google/access-token.ts";
import { googleBase64Url } from "../../lib/google/token-crypto.ts";
import type { GoogleTokenKeyring } from "../../lib/google/token-crypto.ts";
import type { GoogleOAuthRuntime } from "../../lib/google/oauth-exchange.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";
import { readManagedGoogleConnection, readManagedGoogleToken } from "../../db/repositories/google-managed.ts";
import { claimGoogleRefresh } from "../../db/repositories/google-refresh.ts";
import { fixtureGoogleConnection } from "./google-connected.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function rejectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  try { await run(); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === code) return; throw error; }
  throw new Error("필수 실패가 발생하지 않았습니다.");
}

export async function checkGoogleRefreshPreparation(db: D1Database): Promise<readonly string[]> {
  const now: number = Date.parse("2026-10-25T00:00:00Z");
  const checks: string[] = [];
  const runtime: GoogleOAuthRuntime = { now: () => now + 3_599_999, wait: async () => { throw new Error("준비 실패 후 대기 금지"); }, warn: () => { throw new Error("준비 실패 후 재시도 금지"); }, fetch: async () => { throw new Error("복호화 실패 후 Google 호출 금지"); } };
  const cases: readonly Readonly<{ name: string; keyVersion: string; errorCode: string }>[] = [
    { name: "missing-key", keyVersion: "test-v2", errorCode: "google_token_key_missing" },
    { name: "wrong-key", keyVersion: "test-v1", errorCode: "google_token_integrity_invalid" },
  ];
  for (const scenario of cases) {
    const fixture = await fixtureGoogleConnection(db, `refresh-preparation-${scenario.name}`, now);
    const source = await readManagedGoogleToken(db, fixture.owner, fixture.connection);
    const invalid: GoogleTokenKeyring = { activeVersion: scenario.keyVersion, keys: [{ version: scenario.keyVersion, value: googleBase64Url(new Uint8Array(32).fill(9)) }] };
    await rejectCode(() => requireGoogleAccessToken(db, fixture.owner, { clientId: "fixture-client", clientSecret: "fixture-secret", keyring: invalid }, runtime), scenario.errorCode);
    const current = await readManagedGoogleConnection(db, fixture.owner);
    ensure(current?.state === "active" && current.version === fixture.connection.version && current.refreshLeaseId === null, "Google 호출 전 키 오류가 연결을 갱신 중 상태로 변경했습니다.");
    ensure(JSON.stringify(await readManagedGoogleToken(db, fixture.owner, fixture.connection)) === JSON.stringify(source), "복호화 실패 후 암호문 변경");
    ensure(await db.prepare("SELECT id FROM atomic_requests WHERE owner_id=? AND scope='google.refresh.claim'").bind(fixture.owner.userId).first() === null, "복호화 실패 후 갱신 실행권 저장");
    let calls: number = 0;
    const repaired: GoogleOAuthRuntime = { ...runtime, fetch: async () => { calls += 1; return Response.json({ access_token: "repaired-access", token_type: "Bearer", expires_in: 3600, scope: googleRequestedScopes.join(" ") }); } };
    const access = await requireGoogleAccessToken(db, fixture.owner, { clientId: "fixture-client", clientSecret: "fixture-secret", keyring: fixture.keyring }, repaired);
    ensure(calls === 1 && access.token === "repaired-access" && access.connection.state === "active" && access.connection.generation === fixture.connection.generation, "서버 키 수정만으로 정상 갱신을 재개하지 못함");
    checks.push(`refresh-preparation-${scenario.name}-no-state-change-and-repair-without-reconsent`);
  }

  const versionFixture = await fixtureGoogleConnection(db, "refresh-preparation-token-version", now);
  const versionSource = await readManagedGoogleToken(db, versionFixture.owner, versionFixture.connection);
  await db.prepare("UPDATE google_tokens SET version=version+1 WHERE owner_id=? AND connection_id=?").bind(versionFixture.owner.userId, versionFixture.connection.connectionId).run();
  await rejectCode(() => claimGoogleRefresh(db, versionFixture.owner, versionFixture.connection, versionSource, crypto.randomUUID(), runtime.now()), "version_conflict");
  const versionCurrent = await readManagedGoogleConnection(db, versionFixture.owner);
  ensure(versionCurrent?.state === "active" && versionCurrent.version === versionFixture.connection.version && versionCurrent.refreshLeaseId === null, "이전 토큰 버전으로 갱신 실행권 획득");
  ensure((await readManagedGoogleToken(db, versionFixture.owner, versionFixture.connection)).tokenVersion === versionSource.tokenVersion + 1, "토큰 버전 충돌 후 새 값 덮어쓰기");
  checks.push("refresh-preparation-stale-token-version-denied-before-lease");

  const cipherFixture = await fixtureGoogleConnection(db, "refresh-preparation-ciphertext", now);
  const cipherSource = await readManagedGoogleToken(db, cipherFixture.owner, cipherFixture.connection);
  const changedCiphertext: string = (cipherSource.token.ciphertext[0] === "A" ? "B" : "A") + cipherSource.token.ciphertext.slice(1);
  await db.prepare("UPDATE google_tokens SET ciphertext=? WHERE owner_id=? AND connection_id=?").bind(changedCiphertext, cipherFixture.owner.userId, cipherFixture.connection.connectionId).run();
  await rejectCode(() => claimGoogleRefresh(db, cipherFixture.owner, cipherFixture.connection, cipherSource, crypto.randomUUID(), runtime.now()), "version_conflict");
  const cipherCurrent = await readManagedGoogleConnection(db, cipherFixture.owner);
  ensure(cipherCurrent?.state === "active" && cipherCurrent.version === cipherFixture.connection.version && cipherCurrent.refreshLeaseId === null, "복호화 후 바뀐 암호문으로 갱신 실행권 획득");
  checks.push("refresh-preparation-changed-ciphertext-denied-before-lease");

  const connectionFixture = await fixtureGoogleConnection(db, "refresh-preparation-connection", now);
  const connectionSource = await readManagedGoogleToken(db, connectionFixture.owner, connectionFixture.connection);
  await db.prepare("UPDATE google_connections SET version=version+1 WHERE owner_id=? AND id=?").bind(connectionFixture.owner.userId, connectionFixture.connection.connectionId).run();
  await rejectCode(() => claimGoogleRefresh(db, connectionFixture.owner, connectionFixture.connection, connectionSource, crypto.randomUUID(), runtime.now()), "version_conflict");
  const connectionCurrent = await readManagedGoogleConnection(db, connectionFixture.owner);
  ensure(connectionCurrent?.state === "active" && connectionCurrent.version === connectionFixture.connection.version && connectionCurrent.connectionVersion === connectionFixture.connection.connectionVersion + 1 && connectionCurrent.refreshLeaseId === null, "이전 연결 버전으로 갱신 실행권 획득");
  ensure(await db.prepare("SELECT id FROM atomic_requests WHERE owner_id=? AND scope='google.refresh.claim'").bind(connectionFixture.owner.userId).first() === null, "충돌한 갱신 실행권의 성공 영수증 잔존");
  checks.push("refresh-preparation-stale-connection-version-rolls-back-claim");
  return checks;
}
