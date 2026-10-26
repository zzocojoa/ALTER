import { siteIdentity } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { prepareGoogleOAuthAttempt } from "../../lib/google/oauth-state.ts";
import { saveGoogleOAuthAttempt, consumeGoogleOAuthAttempt } from "../../db/repositories/google-oauth.ts";
import { prepareGoogleConnectionWrite, readManagedGoogleConnection, saveManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import type { ManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import { encryptGoogleTokenBundle, googleBase64Url } from "../../lib/google/token-crypto.ts";
import type { GoogleTokenKeyring } from "../../lib/google/token-crypto.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";

export async function fixtureGoogleConnection(db: D1Database, ownerId: string, now: number): Promise<Readonly<{ owner: SiteIdentity; connection: ManagedGoogleConnection; keyring: GoogleTokenKeyring }>> {
  const owner = siteIdentity.parse({ realm: "sites", userId: ownerId });
  const oauth = { ...fixtureGoogleOAuth(now), ownerId };
  const keyring: GoogleTokenKeyring = { activeVersion: "test-v1", keys: [{ version: "test-v1", value: googleBase64Url(new Uint8Array(32).fill(3)) }] };
  const start = await prepareGoogleOAuthAttempt(owner, oauth, { kind: "connect" }, now);
  await saveGoogleOAuthAttempt(db, owner, start.attempt); await consumeGoogleOAuthAttempt(db, owner, start.state, start.handle, oauth.callbackUrl, now);
  const plan = await prepareGoogleConnectionWrite(db, owner, `${ownerId}-subject`, { kind: "connect" });
  const token = await encryptGoogleTokenBundle({ accessToken: "fixture-access", refreshToken: "fixture-refresh", authorizedAt: now }, plan.binding, keyring);
  await saveManagedGoogleConnection(db, plan, start.attempt.id, { subject: `${ownerId}-subject`, email: "fixture@example.test", scopes: [...googleRequestedScopes], authorizedAt: now, accessExpiresAt: now + 3_600_000, refreshExpiresAt: now + 604_800_000 }, token);
  const connection = await readManagedGoogleConnection(db, owner);
  if (connection === null) throw new Error("Google 검증 연결 저장 실패");
  return { owner, connection, keyring };
}
