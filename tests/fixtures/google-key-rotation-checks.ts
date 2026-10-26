import { requireGoogleAccessToken } from "../../lib/google/access-token.ts";
import { decryptGoogleTokenBundle, googleBase64Url, reencryptGoogleTokenBundle } from "../../lib/google/token-crypto.ts";
import type { GoogleTokenBinding, GoogleTokenKeyring } from "../../lib/google/token-crypto.ts";
import type { GoogleOAuthRuntime } from "../../lib/google/oauth-exchange.ts";
import { readManagedGoogleConnection, readManagedGoogleToken } from "../../db/repositories/google-managed.ts";
import { rotateManagedGoogleTokenKey } from "../../db/repositories/google-token-key.ts";
import { claimGoogleRefresh } from "../../db/repositories/google-refresh.ts";
import { beginGoogleDisconnect } from "../../db/repositories/google-disconnect.ts";
import { fixtureGoogleConnection } from "./google-connected.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function rejectCode(run: () => Promise<unknown>, code: string): Promise<void> {
  try { await run(); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === code) return; throw error; }
  throw new Error("필수 차단이 발생하지 않았습니다.");
}
function rotationKeyring(keyring: GoogleTokenKeyring): GoogleTokenKeyring {
  return { activeVersion: "test-v2", keys: [...keyring.keys, { version: "test-v2", value: googleBase64Url(new Uint8Array(32).fill(9)) }] };
}

export async function checkGoogleKeyRotation(db: D1Database): Promise<readonly string[]> {
  const now: number = Date.parse("2026-10-25T00:00:00Z");
  const checks: string[] = [];
  const runtime: GoogleOAuthRuntime = { now: () => now, wait: async () => { throw new Error("키 교체 중 네트워크 대기 금지"); }, warn: () => { throw new Error("키 교체 중 네트워크 재시도 금지"); }, fetch: async () => { throw new Error("키 교체 중 Google 호출 금지"); } };
  const fixture = await fixtureGoogleConnection(db, "key-rotation-owner", now);
  const keyring: GoogleTokenKeyring = rotationKeyring(fixture.keyring);
  const source = await readManagedGoogleToken(db, fixture.owner, fixture.connection);
  const binding: GoogleTokenBinding = { ownerId: fixture.owner.userId, connectionId: fixture.connection.connectionId, generation: fixture.connection.generation };
  const access = await requireGoogleAccessToken(db, fixture.owner, { clientId: "fixture-client", clientSecret: "fixture-secret", keyring }, runtime);
  const current = await readManagedGoogleConnection(db, fixture.owner);
  if (current === null) throw new Error("키 교체 연결 누락");
  const saved = await readManagedGoogleToken(db, fixture.owner, current);
  ensure(access.token === "fixture-access" && saved.token.keyVersion === "test-v2", "새 활성 암호화 키가 D1의 기존 토큰에 반영되지 않았습니다.");
  ensure(saved.tokenVersion === source.tokenVersion + 1 && current.version === fixture.connection.version + 1 && saved.token.nonce !== source.token.nonce, "키 교체 버전 또는 nonce 오류");
  ensure(current.generation === fixture.connection.generation && current.connectionVersion === fixture.connection.connectionVersion && current.accessExpiresAt === fixture.connection.accessExpiresAt && current.refreshExpiresAt === fixture.connection.refreshExpiresAt && current.authorizedAt === fixture.connection.authorizedAt && JSON.stringify(current.scopes) === JSON.stringify(fixture.connection.scopes), "암호화 키 교체가 Google 동의 조건을 변경함");
  const newOnly: GoogleTokenKeyring = { activeVersion: keyring.activeVersion, keys: keyring.keys.filter(key => key.version === keyring.activeVersion) };
  const bundle = await decryptGoogleTokenBundle(saved.token, binding, newOnly);
  ensure(bundle.accessToken === "fixture-access" && bundle.refreshToken === "fixture-refresh" && bundle.authorizedAt === now, "키 교체 시 토큰 원문 변경");
  await rejectCode(() => decryptGoogleTokenBundle(saved.token, binding, fixture.keyring), "google_token_key_missing");
  const reused = await requireGoogleAccessToken(db, fixture.owner, { clientId: "fixture-client", clientSecret: "fixture-secret", keyring: newOnly }, runtime);
  const reusedToken = await readManagedGoogleToken(db, fixture.owner, reused.connection);
  ensure(reused.connection.version === current.version && JSON.stringify(reusedToken) === JSON.stringify(saved), "이미 활성 키인 토큰을 다시 저장함");
  const rows = await db.batch([db.prepare("SELECT * FROM google_tokens WHERE owner_id=?").bind(fixture.owner.userId), db.prepare("SELECT * FROM atomic_requests WHERE owner_id=?").bind(fixture.owner.userId)]);
  const serialized: string = JSON.stringify(rows);
  ensure(!serialized.includes("fixture-access") && !serialized.includes("fixture-refresh") && keyring.keys.every(key => !serialized.includes(key.value)), "키 교체 저장에 평문 비밀값 노출");
  checks.push("key-rotation-access-path-stores-active-key-without-provider-call", "key-rotation-preserves-consent-and-supports-old-key-removal", "key-rotation-active-key-reuse-no-write-or-plaintext");

  const race = await fixtureGoogleConnection(db, "key-rotation-race", now);
  const raceSource = await readManagedGoogleToken(db, race.owner, race.connection);
  const raceBinding: GoogleTokenBinding = { ownerId: race.owner.userId, connectionId: race.connection.connectionId, generation: race.connection.generation };
  const targets = await Promise.all(Array.from({ length: 2 }, () => reencryptGoogleTokenBundle(raceSource.token, raceBinding, rotationKeyring(race.keyring))));
  const races = await Promise.allSettled(targets.map(target => rotateManagedGoogleTokenKey(db, race.owner, race.connection, raceSource, target, now)));
  ensure(races.filter(result => result.status === "fulfilled").length === 1 && races.filter(result => result.status === "rejected" && result.reason instanceof Error && "code" in result.reason && result.reason.code === "version_conflict").length === 1, "동시 키 교체가 단일 저장을 보장하지 못함");
  const raceCurrent = await readManagedGoogleConnection(db, race.owner);
  if (raceCurrent === null) throw new Error("동시 키 교체 연결 누락");
  const raceSaved = await readManagedGoogleToken(db, race.owner, raceCurrent);
  ensure(raceCurrent.version === race.connection.version + 1 && raceSaved.tokenVersion === raceSource.tokenVersion + 1 && targets.some(target => target.ciphertext === raceSaved.token.ciphertext), "동시 키 교체 결과 오류");
  checks.push("key-rotation-concurrent-writers-one-winner");

  const rollback = await fixtureGoogleConnection(db, "key-rotation-rollback", now);
  const rollbackSource = await readManagedGoogleToken(db, rollback.owner, rollback.connection);
  const rollbackTarget = await reencryptGoogleTokenBundle(rollbackSource.token, { ownerId: rollback.owner.userId, connectionId: rollback.connection.connectionId, generation: rollback.connection.generation }, rotationKeyring(rollback.keyring));
  await rejectCode(() => rotateManagedGoogleTokenKey(db, rollback.owner, rollback.connection, { ...rollbackSource, tokenVersion: rollbackSource.tokenVersion + 1 }, rollbackTarget, now), "version_conflict");
  const rollbackCurrent = await readManagedGoogleConnection(db, rollback.owner);
  if (rollbackCurrent === null) throw new Error("키 교체 롤백 연결 누락");
  ensure(rollbackCurrent.version === rollback.connection.version && JSON.stringify(await readManagedGoogleToken(db, rollback.owner, rollbackCurrent)) === JSON.stringify(rollbackSource), "키 교체 실패 후 부분 저장 발생");
  ensure(await db.prepare("SELECT id FROM atomic_requests WHERE owner_id=? AND scope='google.token-key.rotate'").bind(rollback.owner.userId).first() === null, "실패한 키 교체의 성공 영수증 잔존");
  checks.push("key-rotation-token-conflict-rolls-back-runtime-and-receipt");

  const refresh = await fixtureGoogleConnection(db, "key-rotation-refresh", now);
  const refreshSource = await readManagedGoogleToken(db, refresh.owner, refresh.connection);
  const refreshTarget = await reencryptGoogleTokenBundle(refreshSource.token, { ownerId: refresh.owner.userId, connectionId: refresh.connection.connectionId, generation: refresh.connection.generation }, rotationKeyring(refresh.keyring));
  const claimed = await claimGoogleRefresh(db, refresh.owner, refresh.connection, refreshSource, crypto.randomUUID(), now);
  await rejectCode(() => rotateManagedGoogleTokenKey(db, refresh.owner, refresh.connection, refreshSource, refreshTarget, now), "version_conflict");
  ensure((await readManagedGoogleConnection(db, refresh.owner))?.refreshLeaseId === claimed.refreshLeaseId && JSON.stringify(await readManagedGoogleToken(db, refresh.owner, claimed)) === JSON.stringify(refreshSource), "키 교체가 진행 중인 갱신을 덮어씀");
  checks.push("key-rotation-cannot-overwrite-claimed-refresh");

  const disconnect = await fixtureGoogleConnection(db, "key-rotation-disconnect", now);
  const disconnectSource = await readManagedGoogleToken(db, disconnect.owner, disconnect.connection);
  const disconnectTarget = await reencryptGoogleTokenBundle(disconnectSource.token, { ownerId: disconnect.owner.userId, connectionId: disconnect.connection.connectionId, generation: disconnect.connection.generation }, rotationKeyring(disconnect.keyring));
  const disconnected = await beginGoogleDisconnect(db, disconnect.owner, disconnect.connection, crypto.randomUUID(), now);
  await rejectCode(() => rotateManagedGoogleTokenKey(db, disconnect.owner, disconnect.connection, disconnectSource, disconnectTarget, now), "version_conflict");
  ensure((await readManagedGoogleConnection(db, disconnect.owner))?.generation === disconnected.generation && await db.prepare("SELECT id FROM google_tokens WHERE owner_id=?").bind(disconnect.owner.userId).first() === null, "키 교체가 해제된 토큰을 복원함");
  checks.push("key-rotation-after-disconnect-cannot-resurrect-token");

  const missing = await fixtureGoogleConnection(db, "key-rotation-missing", now);
  const missingSource = await readManagedGoogleToken(db, missing.owner, missing.connection);
  await rejectCode(() => requireGoogleAccessToken(db, missing.owner, { clientId: "fixture-client", clientSecret: "fixture-secret", keyring: newOnly }, runtime), "google_token_key_missing");
  ensure((await readManagedGoogleConnection(db, missing.owner))?.version === missing.connection.version && JSON.stringify(await readManagedGoogleToken(db, missing.owner, missing.connection)) === JSON.stringify(missingSource), "키 누락 후 연결 또는 토큰 변경");
  await rejectCode(() => rotateManagedGoogleTokenKey(db, fixture.owner, missing.connection, missingSource, disconnectTarget, now), "version_conflict");
  ensure(JSON.stringify(await readManagedGoogleToken(db, missing.owner, missing.connection)) === JSON.stringify(missingSource), "다른 소유자가 암호문 교체");
  checks.push("key-rotation-missing-key-and-other-owner-denied-without-changes");
  return checks;
}
