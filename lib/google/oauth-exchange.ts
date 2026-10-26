import { createLocalJWKSet, errors, jwtVerify } from "jose";
import type { JWTVerifyGetKey, JWTPayload } from "jose";
import { z } from "zod";
import { contentHash, timestamp } from "../domain/contracts.ts";
import { readBoundedGoogleJson } from "./response.ts";
import { googleFailure } from "./errors.ts";
import { googleRefreshDeadline, requireGoogleTestAccount } from "./oauth-configuration.ts";
import type { GoogleOAuthEvidence } from "./oauth-configuration.ts";
import { parseGoogleGrantedScopes } from "./permissions.ts";
import type { GoogleScope } from "./permissions.ts";
import type { ConsumedGoogleAttempt } from "../../db/repositories/google-oauth.ts";

export type GoogleFetch = (url: string, options: RequestInit) => Promise<Response>;
export type GoogleOAuthWarning = Readonly<{ event: "google_signing_key_retry" | "google_revocation_retry"; attempt: number; status: number | null; delayMs: number }>;
export type GoogleOAuthRuntime = Readonly<{ fetch: GoogleFetch; now: () => number; wait: (milliseconds: number) => Promise<void>; warn: (warning: GoogleOAuthWarning) => void }>;
export type GoogleOAuthTransportFailure = Error & Readonly<{ code: "google_oauth_transport_failed"; operation: "code-exchange" | "refresh" | "signing-keys"; status: number | null; providerError: string | null; outcome: "rejected" | "unknown"; endpoint: string }>;
export type VerifiedGoogleIdentity = Readonly<{ subject: string; email: string; expiresAt: number }>;
export type GoogleConnectionCandidate = Readonly<{ identity: VerifiedGoogleIdentity; scopes: readonly GoogleScope[]; accessToken: string; accessExpiresAt: number; refreshToken: string; refreshExpiresAt: number | null; authorizedAt: number }>;
const tokenEndpoint: string = "https://oauth2.googleapis.com/token";
const keysEndpoint: string = "https://www.googleapis.com/oauth2/v3/certs";
const providerErrors: readonly string[] = ["invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope", "access_denied", "temporarily_unavailable", "server_error"];
const tokenResponse = z.object({ access_token: z.string().min(1).max(8192), token_type: z.literal("Bearer"), expires_in: z.number().int().positive().max(86_400), refresh_token: z.string().min(1).max(8192), refresh_token_expires_in: z.number().int().positive().max(31_536_000).optional(), scope: z.string().min(1).max(2000), id_token: z.string().min(1).max(32_768) });
const identityClaims = z.object({ sub: z.string().regex(/^[\x21-\x7e]{1,200}$/), email: z.string().email().max(254), email_verified: z.union([z.literal(true), z.literal("true")]), nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/), iat: z.number().int().nonnegative(), exp: z.number().int().positive(), azp: z.string().optional() });
const jwks = z.object({ keys: z.array(z.object({ kty: z.literal("RSA"), kid: z.string().min(1).max(200), use: z.literal("sig"), alg: z.literal("RS256"), n: z.string().regex(/^[A-Za-z0-9_-]{100,2000}$/), e: z.string().regex(/^[A-Za-z0-9_-]{1,10}$/) }).strict()).min(1).max(20) }).strict();

function oauthTransportFailure(operation: GoogleOAuthTransportFailure["operation"], status: number | null, raw: unknown, outcome: GoogleOAuthTransportFailure["outcome"]): GoogleOAuthTransportFailure {
  const parsed = z.object({ error: z.string() }).safeParse(raw);
  const providerError: string | null = parsed.success && providerErrors.includes(parsed.data.error) ? parsed.data.error : null;
  return Object.assign(new Error("Google 인증 요청을 완료하지 못했습니다. 응답 상태와 연결 상태를 확인하세요."), { name: "GoogleOAuthTransportFailure", code: "google_oauth_transport_failed" as const, operation, status, providerError, outcome, endpoint: operation === "signing-keys" ? keysEndpoint : tokenEndpoint });
}

/** 공개 서명키 조회만 제한적으로 재시도하며 code 교환에는 같은 정책을 적용하지 않습니다. */
export async function loadGoogleSigningKeys(runtime: GoogleOAuthRuntime): Promise<JWTVerifyGetKey> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    let status: number | null = null;
    let response: Response;
    try { response = await runtime.fetch(keysEndpoint, { method: "GET", redirect: "manual", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }); }
    catch (error: unknown) {
      if (!(error instanceof TypeError || error instanceof DOMException)) throw error;
      if (attempt === 3) throw oauthTransportFailure("signing-keys", null, null, "rejected");
      const delayMs: number = 1000 * attempt; runtime.warn({ event: "google_signing_key_retry", attempt, status, delayMs }); await runtime.wait(delayMs); continue;
    }
    status = response.status;
    if (response.status !== 200) {
      await response.body?.cancel();
      if (attempt === 3 || response.status !== 429 && response.status < 500) throw oauthTransportFailure("signing-keys", status, null, "rejected");
      const retryAfter: string | null = response.headers.get("retry-after");
      const delayMs: number = retryAfter === null ? 1000 * attempt : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - runtime.now();
      if (!Number.isFinite(delayMs) || delayMs > 30_000) throw oauthTransportFailure("signing-keys", status, null, "rejected");
      runtime.warn({ event: "google_signing_key_retry", attempt, status, delayMs: Math.max(0, delayMs) }); await runtime.wait(Math.max(0, delayMs)); continue;
    }
    let body: unknown;
    try { body = await readBoundedGoogleJson(response, 65_536); }
    catch (error: unknown) { if (error instanceof Error && error.name === "MaterialFailure") throw oauthTransportFailure("signing-keys", status, null, "rejected"); throw error; }
    const parsed = jwks.safeParse(body);
    if (!parsed.success) throw oauthTransportFailure("signing-keys", status, null, "rejected");
    return createLocalJWKSet(parsed.data);
  }
  throw oauthTransportFailure("signing-keys", null, null, "rejected");
}

/** 해독된 문자열만 신뢰하지 않고 Google 서명·발급자·대상·만료·nonce를 모두 검증합니다. */
export async function verifyGoogleIdentity(token: string, clientId: string, nonceHash: string, now: number, signingKey: JWTVerifyGetKey): Promise<VerifiedGoogleIdentity> {
  timestamp.parse(now);
  let payload: JWTPayload;
  try { payload = (await jwtVerify(token, signingKey, { algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"], audience: clientId, requiredClaims: ["sub", "exp", "iat", "nonce", "email", "email_verified"], clockTolerance: 0, currentDate: new Date(now) })).payload; }
  catch (error: unknown) { if (error instanceof errors.JOSEError) throw googleFailure("google_identity_invalid", error.code); throw error; }
  const claims = identityClaims.safeParse(payload);
  if (!claims.success || claims.data.iat > Math.floor(now / 1000) || claims.data.azp !== undefined && claims.data.azp !== clientId || Array.isArray(payload.aud) && payload.aud.length > 1 && claims.data.azp !== clientId || await contentHash(claims.data.nonce) !== nonceHash) throw googleFailure("google_identity_invalid", "identity-claims");
  return { subject: claims.data.sub, email: claims.data.email, expiresAt: timestamp.parse(claims.data.exp * 1000) };
}

/** 이미 소비한 state만 받으며 code 교환 결과가 불명확하면 동일 code를 재전송하지 않습니다. */
export async function exchangeGoogleCode(runtime: GoogleOAuthRuntime, oauth: GoogleOAuthEvidence, attempt: ConsumedGoogleAttempt, code: string, clientSecret: string, existingGoogleSubject: string | null): Promise<GoogleConnectionCandidate> {
  if (!code || code.length > 4096 || !clientSecret || attempt.callbackUrl !== oauth.callbackUrl || oauth.publishing === "unknown") throw googleFailure("google_configuration_invalid", "code-exchange-input");
  const signingKey: JWTVerifyGetKey = await loadGoogleSigningKeys(runtime);
  let response: Response;
  try { response = await runtime.fetch(tokenEndpoint, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ code, client_id: oauth.clientId, client_secret: clientSecret, redirect_uri: oauth.callbackUrl, grant_type: "authorization_code" }).toString(), signal: AbortSignal.timeout(15_000) }); }
  catch (error: unknown) { if (error instanceof TypeError || error instanceof DOMException) throw oauthTransportFailure("code-exchange", null, null, "unknown"); throw error; }
  let raw: unknown;
  try { raw = await readBoundedGoogleJson(response, 65_536); }
  catch (error: unknown) { if (error instanceof Error && error.name === "MaterialFailure") throw oauthTransportFailure("code-exchange", response.status, null, "unknown"); throw error; }
  if (!response.ok) throw oauthTransportFailure("code-exchange", response.status, raw, response.status >= 500 ? "unknown" : "rejected");
  const parsed = tokenResponse.safeParse(raw);
  if (!parsed.success) throw oauthTransportFailure("code-exchange", response.status, null, "unknown");
  const token: z.infer<typeof tokenResponse> = parsed.data;
  const now: number = runtime.now();
  const identity: VerifiedGoogleIdentity = await verifyGoogleIdentity(token.id_token, oauth.clientId, attempt.nonceHash, now, signingKey);
  requireGoogleTestAccount(oauth, identity.email);
  const scopes: readonly GoogleScope[] = parseGoogleGrantedScopes(token.scope);
  if (existingGoogleSubject !== null && existingGoogleSubject !== identity.subject && attempt.purpose.kind !== "reconnect") throw googleFailure("google_account_replacement_denied", "identity-subject");
  return { identity, scopes, accessToken: token.access_token, accessExpiresAt: timestamp.parse(now + token.expires_in * 1000), refreshToken: token.refresh_token, refreshExpiresAt: googleRefreshDeadline(now, oauth.publishing, token.refresh_token_expires_in ?? null), authorizedAt: now };
}

export type GoogleRefreshResponse = Readonly<{ accessToken: string; refreshToken: string | null; scopes: readonly GoogleScope[]; accessExpiresAt: number; refreshExpiresAt: number | null }>;
/** refresh token 미반환은 기존 토큰 유지라는 OAuth 계약이며 새 토큰이 있을 때만 교체합니다. */
export async function exchangeGoogleRefresh(runtime: GoogleOAuthRuntime, clientId: string, clientSecret: string, refreshToken: string, currentRefreshExpiresAt: number | null): Promise<GoogleRefreshResponse> {
  if (!clientId || !clientSecret || !refreshToken) throw googleFailure("google_configuration_invalid", "refresh-input");
  let response: Response;
  try { response = await runtime.fetch(tokenEndpoint, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(), signal: AbortSignal.timeout(15_000) }); }
  catch (error: unknown) { if (error instanceof TypeError || error instanceof DOMException) throw oauthTransportFailure("refresh", null, null, "unknown"); throw error; }
  let raw: unknown;
  try { raw = await readBoundedGoogleJson(response, 65_536); }
  catch (error: unknown) { if (error instanceof Error && error.name === "MaterialFailure" || error instanceof TypeError || error instanceof DOMException) throw oauthTransportFailure("refresh", response.status, null, "unknown"); throw error; }
  if (!response.ok) throw oauthTransportFailure("refresh", response.status, raw, response.status >= 500 ? "unknown" : "rejected");
  const parsed = tokenResponse.omit({ id_token: true }).extend({ refresh_token: z.string().min(1).max(8192).optional() }).safeParse(raw);
  if (!parsed.success) throw oauthTransportFailure("refresh", response.status, null, "unknown");
  const now: number = runtime.now();
  const providerDeadline: number | null = parsed.data.refresh_token_expires_in === undefined ? null : timestamp.parse(now + parsed.data.refresh_token_expires_in * 1000);
  const refreshExpiresAt: number | null = currentRefreshExpiresAt === null ? providerDeadline : providerDeadline === null ? currentRefreshExpiresAt : Math.min(currentRefreshExpiresAt, providerDeadline);
  return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token ?? null, scopes: parseGoogleGrantedScopes(parsed.data.scope), accessExpiresAt: timestamp.parse(now + parsed.data.expires_in * 1000), refreshExpiresAt };
}
