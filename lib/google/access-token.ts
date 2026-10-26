import { rotateManagedGoogleTokenKey } from "../../db/repositories/google-token-key.ts";
import { googleFailure } from "./errors.ts";
import { decryptGoogleTokenBundle, encryptGoogleTokenBundle } from "./token-crypto.ts";
import type { GoogleTokenBinding, GoogleTokenBundle, GoogleTokenKeyring } from "./token-crypto.ts";
import { exchangeGoogleRefresh } from "./oauth-exchange.ts";
import type { GoogleOAuthRuntime } from "./oauth-exchange.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { claimGoogleRefresh, completeGoogleRefresh, expireGoogleAuthorization, expireGoogleRefreshLease, failGoogleRefresh } from "../../db/repositories/google-refresh.ts";
import { readManagedGoogleConnection, readManagedGoogleToken } from "../../db/repositories/google-managed.ts";
import type { ManagedGoogleConnection, StoredGoogleToken } from "../../db/repositories/google-managed.ts";

export type GoogleAccessToken = Readonly<{ token: string; connection: ManagedGoogleConnection }>;
export type GoogleCredentialSettings = Readonly<{ clientId: string; clientSecret: string; keyring: GoogleTokenKeyring }>;

type PreparedGoogleAccessToken = Readonly<{ current: ManagedGoogleConnection; binding: GoogleTokenBinding; saved: StoredGoogleToken; bundle: GoogleTokenBundle; now: number }>;

/** 갱신 실행권을 얻기 전에 연결 만료와 암호문 무결성을 확인합니다. */
async function prepareGoogleAccessToken(db: D1Database, owner: SiteIdentity, settings: GoogleCredentialSettings, runtime: GoogleOAuthRuntime): Promise<PreparedGoogleAccessToken> {
  const current: ManagedGoogleConnection | null = await readManagedGoogleConnection(db, owner);
  const now: number = runtime.now();
  if (current === null) throw googleFailure("google_connection_unavailable", "access-not-connected");
  if (current.state === "refreshing" && current.refreshLeaseExpiresAt !== null && current.refreshLeaseExpiresAt <= now) await expireGoogleRefreshLease(db, owner, current, now);
  if (!["active", "partial"].includes(current.state)) throw googleFailure("google_connection_unavailable", "access-state");
  if (current.refreshExpiresAt !== null && current.refreshExpiresAt <= now) { await expireGoogleAuthorization(db, owner, current, now); throw googleFailure("google_connection_unavailable", "authorization-expired"); }
  const binding: GoogleTokenBinding = { ownerId: owner.userId, connectionId: current.connectionId, generation: current.generation };
  const saved = await readManagedGoogleToken(db, owner, current);
  const bundle = await decryptGoogleTokenBundle(saved.token, binding, settings.keyring);
  return { current, binding, saved, bundle, now };
}

/** D1의 현재 세대를 확인하고 유효한 토큰은 외부 갱신 없이 재사용합니다. */
export async function requireGoogleAccessToken(db: D1Database, owner: SiteIdentity, settings: GoogleCredentialSettings, runtime: GoogleOAuthRuntime): Promise<GoogleAccessToken> {
  const prepared: PreparedGoogleAccessToken = await prepareGoogleAccessToken(db, owner, settings, runtime);
  const { current, binding, saved, bundle, now } = prepared;
  if (current.accessExpiresAt > now + 60_000) {
    if (saved.token.keyVersion === settings.keyring.activeVersion) return { token: bundle.accessToken, connection: current };
    const encrypted = await encryptGoogleTokenBundle(bundle, binding, settings.keyring);
    const receipt = await rotateManagedGoogleTokenKey(db, owner, current, saved, encrypted, runtime.now());
    const latest: ManagedGoogleConnection | null = await readManagedGoogleConnection(db, owner);
    if (latest === null || latest.version !== receipt.version || latest.generation !== current.generation || latest.connectionId !== current.connectionId || !["active", "partial"].includes(latest.state)) throw googleFailure("google_connection_unavailable", "token-key-rotation-replaced");
    return { token: bundle.accessToken, connection: latest };
  }
  return executeGoogleTokenRefresh(db, owner, settings, runtime, prepared, crypto.randomUUID());
}

/** 명시적 갱신도 동일한 암호화·동시성 경로를 거치며 동의 유효기간은 늘리지 않습니다. */
export async function renewGoogleAccessToken(db: D1Database, owner: SiteIdentity, settings: GoogleCredentialSettings, runtime: GoogleOAuthRuntime, leaseId: string): Promise<GoogleAccessToken> {
  return executeGoogleTokenRefresh(db, owner, settings, runtime, await prepareGoogleAccessToken(db, owner, settings, runtime), leaseId);
}

async function executeGoogleTokenRefresh(db: D1Database, owner: SiteIdentity, settings: GoogleCredentialSettings, runtime: GoogleOAuthRuntime, prepared: PreparedGoogleAccessToken, leaseId: string): Promise<GoogleAccessToken> {
  const { current, binding, saved, bundle } = prepared;
  const claimed: ManagedGoogleConnection = await claimGoogleRefresh(db, owner, current, saved, leaseId, runtime.now());
  let received: Awaited<ReturnType<typeof exchangeGoogleRefresh>>;
  try { received = await exchangeGoogleRefresh(runtime, settings.clientId, settings.clientSecret, bundle.refreshToken, current.refreshExpiresAt); }
  catch (error: unknown) {
    const invalidGrant: boolean = error instanceof Error && "providerError" in error && error.providerError === "invalid_grant";
    await failGoogleRefresh(db, owner, claimed, invalidGrant ? "invalid-grant" : "unknown", runtime.now());
    throw error;
  }
  const encrypted = await encryptGoogleTokenBundle({ accessToken: received.accessToken, refreshToken: received.refreshToken ?? bundle.refreshToken, authorizedAt: bundle.authorizedAt }, binding, settings.keyring);
  await completeGoogleRefresh(db, owner, claimed, { token: encrypted, tokenVersion: saved.tokenVersion, scopes: received.scopes, accessExpiresAt: received.accessExpiresAt, refreshExpiresAt: received.refreshExpiresAt, now: runtime.now() });
  const latest: ManagedGoogleConnection | null = await readManagedGoogleConnection(db, owner);
  if (latest === null || latest.generation !== claimed.generation || latest.version !== claimed.version + 1 || latest.connectionId !== claimed.connectionId || !["active", "partial"].includes(latest.state)) throw googleFailure("google_connection_unavailable", "refresh-result-replaced");
  return { token: received.accessToken, connection: latest };
}
