import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWTPayload, JSONWebKeySet } from "jose";
import { describe, expect, it } from "vitest";
import { contentHash } from "../../lib/domain/contracts.ts";
import { exchangeGoogleCode, loadGoogleSigningKeys, verifyGoogleIdentity } from "../../lib/google/oauth-exchange.ts";
import type { GoogleOAuthRuntime, GoogleOAuthWarning } from "../../lib/google/oauth-exchange.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";
import { fixtureGoogleOAuth } from "../fixtures/google-oauth.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const nonce: string = "A".repeat(43);
const nonceHash: string = await contentHash(nonce);
const oauth = fixtureGoogleOAuth(now);
const keys = await generateKeyPair("RS256", { extractable: true });
const publicKey = await exportJWK(keys.publicKey);
const jwks: JSONWebKeySet = { keys: [{ kty: publicKey.kty, n: publicKey.n, e: publicKey.e, kid: "test-key", use: "sig", alg: "RS256" }] };
const resolver = createLocalJWKSet(jwks);
const attempt = { id: "00000000-0000-4000-a000-000000001400", nonceHash, callbackUrl: oauth.callbackUrl, purpose: { kind: "connect" as const } };
async function signed(changes: Readonly<JWTPayload>): Promise<string> {
  return new SignJWT({ iss: "https://accounts.google.com", aud: oauth.clientId, sub: "google-subject", email: "google@example.test", email_verified: true, nonce, iat: now / 1000, exp: now / 1000 + 3600, ...changes }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(keys.privateKey);
}

describe("Google ID 토큰 검증", () => {
  it("Google sub와 이메일을 검증하고 Sites 이메일과 독립적으로 취급한다", async () => {
    await expect(verifyGoogleIdentity(await signed({}), oauth.clientId, nonceHash, now, resolver)).resolves.toEqual({ subject: "google-subject", email: "google@example.test", expiresAt: now + 3_600_000 });
  });
  it("서명·issuer·audience·만료·발급시각·nonce·azp를 모두 검사한다", async () => {
    for (const changes of [{ iss: "https://evil.test" }, { aud: "other-client" }, { exp: now / 1000 }, { iat: now / 1000 + 1 }, { nonce: "B".repeat(43) }, { azp: "other-client" }, { aud: [oauth.clientId, "other-client"] }, { email_verified: false }, { email: "not-an-email" }, { sub: "" }]) await expect(verifyGoogleIdentity(await signed(changes), oauth.clientId, nonceHash, now, resolver)).rejects.toMatchObject({ code: "google_identity_invalid" });
    const wrong = await generateKeyPair("RS256", { extractable: true });
    const invalid: string = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(wrong.privateKey);
    await expect(verifyGoogleIdentity(invalid, oauth.clientId, nonceHash, now, resolver)).rejects.toMatchObject({ code: "google_identity_invalid" });
    await expect(verifyGoogleIdentity("invalid", oauth.clientId, nonceHash, now, resolver)).rejects.toMatchObject({ code: "google_identity_invalid" });
  });
});

describe("Google 서버 code 교환", () => {
  it("공식 HTTPS에 서버 비밀값을 보내고 검증한 토큰 후보만 반환한다", async () => {
    const jwt: string = await signed({}); const calls: string[] = [];
    const runtime: GoogleOAuthRuntime = { now: () => now, wait: async () => {}, warn: () => {}, fetch: async (url, options) => {
      calls.push(url); expect(options.redirect).toBe("manual");
      if (url.endsWith("/certs")) return Response.json(jwks);
      expect(url).toBe("https://oauth2.googleapis.com/token");
      const body: URLSearchParams = new URLSearchParams(String(options.body));
      expect(body.get("client_secret")).toBe("secret-value"); expect(body.get("code")).toBe("one-time-code"); expect(body.get("redirect_uri")).toBe(oauth.callbackUrl);
      return Response.json({ access_token: "access-value", refresh_token: "refresh-value", token_type: "Bearer", expires_in: 3600, id_token: jwt, scope: googleRequestedScopes.join(" "), unknownProviderField: "ignored" });
    } };
    const candidate = await exchangeGoogleCode(runtime, oauth, attempt, "one-time-code", "secret-value", null);
    expect(candidate.identity.subject).toBe("google-subject"); expect(candidate.refreshExpiresAt).toBe(now + 604_800_000); expect(calls).toHaveLength(2);
    await expect(exchangeGoogleCode(runtime, oauth, attempt, "one-time-code", "secret-value", "other-subject")).rejects.toMatchObject({ code: "google_account_replacement_denied" });
  });
  it("서버 401과 오류 본문에서 비밀값을 제거하고 자동 code 재시도를 하지 않는다", async () => {
    let exchanges: number = 0;
    const runtime: GoogleOAuthRuntime = { now: () => now, wait: async () => {}, warn: () => {}, fetch: async url => {
      if (url.endsWith("/certs")) return Response.json(jwks);
      exchanges += 1;
      return Response.json({ error: "invalid_client", error_description: "secret-value one-time-code", access_token: "access-value" }, { status: 401 });
    } };
    await expect(exchangeGoogleCode(runtime, oauth, attempt, "one-time-code", "secret-value", null)).rejects.toMatchObject({ code: "google_oauth_transport_failed", status: 401, providerError: "invalid_client", outcome: "rejected" });
    expect(exchanges).toBe(1);
    try { await exchangeGoogleCode(runtime, oauth, attempt, "one-time-code", "secret-value", null); }
    catch (error: unknown) { expect(JSON.stringify(error)).not.toMatch(/secret-value|one-time-code|access-value/); }
  });
  it("응답 유실·서버 500·잘못된 JSON·refresh token 누락을 미확정으로 남긴다", async () => {
    for (const kind of ["network", "server", "json", "missing-refresh"]) {
      let exchanges: number = 0;
      const runtime: GoogleOAuthRuntime = { now: () => now, wait: async () => {}, warn: () => {}, fetch: async url => {
        if (url.endsWith("/certs")) return Response.json(jwks);
        exchanges += 1;
        if (kind === "network") throw new TypeError("connection lost");
        if (kind === "server") return Response.json({ error: "server_error" }, { status: 500 });
        if (kind === "json") return new Response("invalid", { headers: { "content-type": "application/json" } });
        return Response.json({ access_token: "access-value", expires_in: 3600, token_type: "Bearer", scope: "openid email", id_token: await signed({}) });
      } };
      await expect(exchangeGoogleCode(runtime, oauth, attempt, "one-time-code", "secret-value", null)).rejects.toMatchObject({ code: "google_oauth_transport_failed", outcome: "unknown" });
      expect(exchanges).toBe(1);
    }
  });
  it("공개키 GET만 Retry-After와 경고를 적용하며 최대 세 번 조회한다", async () => {
    const warnings: GoogleOAuthWarning[] = []; const waits: number[] = []; let calls: number = 0;
    const runtime: GoogleOAuthRuntime = { now: () => now, wait: async ms => { waits.push(ms); }, warn: warning => { warnings.push(warning); }, fetch: async () => {
      calls += 1; return calls < 3 ? Response.json({}, { status: 429, headers: { "retry-after": "2" } }) : Response.json(jwks);
    } };
    await loadGoogleSigningKeys(runtime); expect(calls).toBe(3); expect(waits).toEqual([2000, 2000]); expect(warnings).toHaveLength(2);
    const denied: GoogleOAuthRuntime = { ...runtime, fetch: async () => Response.json({}, { status: 429, headers: { "retry-after": "31" } }) };
    await expect(loadGoogleSigningKeys(denied)).rejects.toMatchObject({ operation: "signing-keys", status: 429 });
  });
});
