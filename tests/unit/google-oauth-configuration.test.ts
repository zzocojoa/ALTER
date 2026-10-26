import { describe, expect, it } from "vitest";
import { googleRefreshDeadline, requireGoogleConfiguration, requireGoogleOAuth, requireGoogleTestAccount } from "../../lib/google/oauth-configuration.ts";
import type { GoogleOAuthEvidence } from "../../lib/google/oauth-configuration.ts";
import { fixtureGoogleConfiguration } from "../fixtures/google-oauth.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const configuration = fixtureGoogleConfiguration(now);
function check(oauth: GoogleOAuthEvidence): GoogleOAuthEvidence { return requireGoogleOAuth({ ...configuration, oauth }, "owner", configuration.oauth.origin, configuration.oauth.clientId, now); }

describe("Google 웹 OAuth 환경과 게시 요건", () => {
  it("서버 설정에서 등록된 독립 callback만 허용한다", () => {
    expect(check(configuration.oauth).callbackUrl).toBe("https://alter.example.test/api/google/oauth/callback");
    expect(requireGoogleConfiguration(JSON.stringify(configuration))).toEqual(configuration);
  });
  it.each(["/callback", "/api/google/oauth/callback?return=https://evil.test", "/api/google/oauth/callback#hash", "/api/google/oauth/callback/", "/%61pi/google/oauth/callback"])("등록 주소 혼용을 거부한다: %s", (path: string) => {
    const address: string = `${configuration.oauth.origin}${path}`;
    expect(() => check({ ...configuration.oauth, callbackUrl: address, registeredCallbacks: [address] })).toThrow(expect.objectContaining({ code: "google_oauth_unverified" }));
  });
  it("실제 origin·client·프로젝트와 콘솔 기록 불일치를 거부한다", () => {
    for (const change of [{ origin: "https://other.example.test" }, { clientId: "123456789-other.apps.googleusercontent.com" }, { projectId: "other-project" }, { registeredOrigins: ["https://other.example.test"] }, { registeredCallbacks: ["https://other.example.test/api/google/oauth/callback"] }, { consoleSource: "https://console.cloud.google.com/auth/clients?project=other-project" }, { validUntil: now }]) expect(() => check({ ...configuration.oauth, ...change })).toThrow();
  });
  it("운영 HTTP와 개발 외부 주소를 허용하지 않는다", () => {
    expect(() => check({ ...configuration.oauth, environment: "development" })).toThrow();
    const origin: string = "http://localhost:3000";
    const callbackUrl: string = `${origin}/api/google/oauth/callback`;
    const oauth: GoogleOAuthEvidence = { ...configuration.oauth, environment: "development", origin, callbackUrl, registeredOrigins: [origin], registeredCallbacks: [callbackUrl] };
    expect(() => requireGoogleOAuth({ ...configuration, oauth }, "owner", origin, oauth.clientId, now)).not.toThrow();
    expect(() => requireGoogleOAuth({ ...configuration, oauth: { ...oauth, environment: "production" } }, "owner", origin, oauth.clientId, now)).toThrow();
  });
  it("게시·검증·테스트 사용자 미확인은 연결을 시작하지 않는다", () => {
    for (const change of [{ publishing: "unknown" as const }, { verification: "unverified" as const }, { approvedTestEmails: [] }]) expect(() => check({ ...configuration.oauth, ...change })).toThrow(expect.objectContaining({ code: "google_oauth_unverified" }));
    expect(() => check({ ...configuration.oauth, publishing: "production", approvedTestEmails: [] })).not.toThrow();
    expect(() => requireGoogleTestAccount(configuration.oauth, "not-registered@example.test")).toThrow();
    expect(() => requireGoogleTestAccount(configuration.oauth, "google@example.test")).not.toThrow();
  });
  it("설정 원문이나 비밀값을 JSON·스키마 오류에 노출하지 않는다", () => {
    for (const raw of [undefined, '{"secret":"do-not-print"', '{"secret":"do-not-print"}']) {
      expect(() => requireGoogleConfiguration(raw)).toThrow(expect.objectContaining({ code: "google_configuration_invalid" }));
      expect(() => requireGoogleConfiguration(raw)).toThrow(expect.not.objectContaining({ message: expect.stringContaining("do-not-print") }));
    }
  });
  it("Testing의 7일 만료와 제공사 지정 만료 중 더 이른 시각을 사용한다", () => {
    expect(googleRefreshDeadline(now, "testing", null)).toBe(now + 604_800_000);
    expect(googleRefreshDeadline(now, "testing", 3600)).toBe(now + 3_600_000);
    expect(googleRefreshDeadline(now, "testing", 999_999)).toBe(now + 604_800_000);
    expect(googleRefreshDeadline(now, "production", null)).toBeNull();
    expect(googleRefreshDeadline(now, "production", 3600)).toBe(now + 3_600_000);
    expect(() => googleRefreshDeadline(now, "testing", -1)).toThrow();
  });
});
