import { describe, expect, it } from "vitest";
import { contentHash } from "../../lib/domain/contracts.ts";
import { expireGoogleAttemptCookie, googleAttemptCookie, googleAttemptCookieName, googleAuthorizationUrl, googleCallbackHashes, prepareGoogleOAuthAttempt, readGoogleAttemptCookie } from "../../lib/google/oauth-state.ts";
import { fixtureGoogleOAuth } from "../fixtures/google-oauth.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const owner = { realm: "sites", userId: "owner" } as const;
const oauth = fixtureGoogleOAuth(now);

describe("Google 소유자 브라우저 연결 시도", () => {
  it("독립 난수 세 개를 만들고 저장 자료에는 해시만 포함한다", async () => {
    const first = await prepareGoogleOAuthAttempt(owner, oauth, { kind: "connect" }, now);
    const second = await prepareGoogleOAuthAttempt(owner, oauth, { kind: "connect" }, now);
    expect(new Set([first.state, first.handle, first.nonce, second.state, second.handle, second.nonce]).size).toBe(6);
    expect(first.attempt.nonceHash).toBe(await contentHash(first.nonce));
    expect(JSON.stringify(first.attempt)).not.toContain(first.state);
    expect(JSON.stringify(first.attempt)).not.toContain(first.handle);
    expect(JSON.stringify(first.attempt)).not.toContain(first.nonce);
    expect(first.attempt.expiresAt).toBe(now + 600_000);
    expect(await googleCallbackHashes(first.state, first.handle)).toEqual({ stateHash: first.attempt.stateHash, handleHash: first.attempt.handleHash });
  });
  it("OAuth 전용 쿠키는 안전 속성과 명시적 만료를 갖는다", async () => {
    const start = await prepareGoogleOAuthAttempt(owner, oauth, { kind: "connect" }, now);
    expect(googleAttemptCookie(start.handle)).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(googleAttemptCookie(start.handle)).toContain("Path=/; Max-Age=600");
    expect(expireGoogleAttemptCookie()).toContain("Max-Age=0");
    expect(readGoogleAttemptCookie(`other=value; ${googleAttemptCookieName}=${start.handle}`)).toBe(start.handle);
    for (const value of [null, "", `${googleAttemptCookieName}=wrong`, `${googleAttemptCookieName}=${start.handle}; ${googleAttemptCookieName}=${start.handle}`]) expect(() => readGoogleAttemptCookie(value)).toThrow(expect.objectContaining({ code: "google_oauth_state_invalid" }));
  });
  it("서버 callback·최소 권한·nonce를 사용하고 임의 누적 권한을 요청하지 않는다", async () => {
    const start = await prepareGoogleOAuthAttempt(owner, oauth, { kind: "connect" }, now);
    const url: URL = new URL(googleAuthorizationUrl(oauth, start));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(oauth.callbackUrl);
    expect(url.searchParams.get("nonce")).toBe(start.nonce);
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(() => googleAuthorizationUrl({ ...oauth, callbackUrl: "https://evil.test" }, start)).toThrow();
    await expect(prepareGoogleOAuthAttempt({ realm: "sites", userId: "other" }, oauth, { kind: "connect" }, now)).rejects.toThrow();
    await expect(googleCallbackHashes("invalid", start.handle)).rejects.toThrow();
  });
});
