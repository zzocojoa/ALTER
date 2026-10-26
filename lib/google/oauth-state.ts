import { z } from "zod";
import { contentHash, recordId, siteIdentity, timestamp, version } from "../domain/contracts.ts";
import { googleFailure } from "./errors.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import type { GoogleOAuthEvidence } from "./oauth-configuration.ts";
import { googleRequestedScopes } from "./permissions.ts";
import { googleBase64Url } from "./token-crypto.ts";

const randomValue = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const oauthPurpose = z.discriminatedUnion("kind", [z.object({ kind: z.literal("connect") }).strict(), z.object({ kind: z.literal("reconnect"), connectionId: recordId, generation: version }).strict()]);
export type OAuthPurpose = Readonly<z.infer<typeof oauthPurpose>>;
export type OAuthAttempt = Readonly<{ id: string; ownerId: string; stateHash: string; handleHash: string; nonceHash: string; callbackUrl: string; purpose: OAuthPurpose; createdAt: number; expiresAt: number }>;
export type OAuthStart = Readonly<{ attempt: OAuthAttempt; state: string; handle: string; nonce: string }>;
export const googleAttemptCookieName = "__Host-alter-google-attempt";

function oauthRandom(): string {
  const bytes: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(32));
  return googleBase64Url(bytes);
}
export async function prepareGoogleOAuthAttempt(owner: SiteIdentity, oauth: GoogleOAuthEvidence, purpose: OAuthPurpose, now: number): Promise<OAuthStart> {
  siteIdentity.parse(owner); oauthPurpose.parse(purpose); timestamp.parse(now);
  if (owner.userId !== oauth.ownerId || oauth.callbackUrl !== `${oauth.origin}/api/google/oauth/callback`) throw googleFailure("google_oauth_unverified", "oauth-start-owner");
  const state: string = oauthRandom(); const handle: string = oauthRandom(); const nonce: string = oauthRandom();
  const [stateHash, handleHash, nonceHash]: readonly string[] = await Promise.all([contentHash(state), contentHash(handle), contentHash(nonce)]);
  return { state, handle, nonce, attempt: { id: crypto.randomUUID(), ownerId: owner.userId, stateHash, handleHash, nonceHash, callbackUrl: oauth.callbackUrl, purpose: oauthPurpose.parse(purpose), createdAt: now, expiresAt: timestamp.parse(now + 600_000) } };
}
export function googleAuthorizationUrl(oauth: GoogleOAuthEvidence, start: OAuthStart): string {
  randomValue.parse(start.state); randomValue.parse(start.handle); randomValue.parse(start.nonce);
  if (start.attempt.ownerId !== oauth.ownerId || start.attempt.callbackUrl !== oauth.callbackUrl) throw googleFailure("google_oauth_unverified", "oauth-start-binding");
  const url: URL = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: oauth.clientId, redirect_uri: oauth.callbackUrl, response_type: "code", scope: googleRequestedScopes.join(" "), access_type: "offline", include_granted_scopes: "false", prompt: "consent select_account", state: start.state, nonce: start.nonce }).toString();
  return url.toString();
}
export function googleAttemptCookie(handle: string): string {
  randomValue.parse(handle);
  return `${googleAttemptCookieName}=${handle}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`;
}
export function expireGoogleAttemptCookie(): string { return `${googleAttemptCookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`; }
export function readGoogleAttemptCookie(header: string | null): string {
  if (!header || header.length > 16_384) throw googleFailure("google_oauth_state_invalid", "oauth-cookie");
  const values: readonly string[] = header.split(";").map((part: string): string => part.trim()).filter((part: string): boolean => part.startsWith(`${googleAttemptCookieName}=`));
  if (values.length !== 1) throw googleFailure("google_oauth_state_invalid", "oauth-cookie");
  const value: string = values[0].slice(googleAttemptCookieName.length + 1);
  if (!randomValue.safeParse(value).success) throw googleFailure("google_oauth_state_invalid", "oauth-cookie");
  return value;
}
export async function googleCallbackHashes(state: string, handle: string): Promise<Readonly<{ stateHash: string; handleHash: string }>> {
  if (!randomValue.safeParse(state).success || !randomValue.safeParse(handle).success) throw googleFailure("google_oauth_state_invalid", "oauth-state-format");
  const [stateHash, handleHash]: readonly string[] = await Promise.all([contentHash(state), contentHash(handle)]);
  return { stateHash, handleHash };
}
