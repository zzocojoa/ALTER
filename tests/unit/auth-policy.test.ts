import { describe, expect, it } from "vitest";
import { decideOwner, requireReturnPath, requireSameOrigin } from "../../lib/auth-policy";
import { enrollmentEnabled } from "../../lib/enrollment-policy";
import { privateFileKey } from "../../lib/private-file";
import { readBoundedBody } from "../../lib/bounded-body";
import { requireGoogleSettings, requireOpenAIKey } from "../../lib/runtime-settings";

const owner = Object.freeze({ userId: "owner-test", email: "first@example.test" });

describe("소유자 인증", () => {
  it("정확한 서버 userId로 판정하고 이메일 변경과 Google 연결 부재에 영향받지 않는다", () => {
    expect(decideOwner(owner, "owner-test", undefined)).toEqual({ kind: "owner" });
    expect(decideOwner({ ...owner, email: "changed@example.test" }, "owner-test", "0")).toEqual({ kind: "owner" });
    expect(owner.email).toBe("first@example.test");
  });
  it("다른 계정·누락 신원·빈 설정·운영 모의를 거부한다", () => {
    expect(decideOwner({ ...owner, userId: "attacker" }, "owner-test", undefined).kind).toBe("forbidden");
    expect(decideOwner(null, "owner-test", undefined).kind).toBe("unauthenticated");
    expect(decideOwner({ ...owner, userId: "" }, "owner-test", undefined).kind).toBe("unauthenticated");
    expect(decideOwner(owner, "", undefined).kind).toBe("configuration-error");
    expect(decideOwner(owner, "owner-test ", undefined).kind).toBe("configuration-error");
    expect(decideOwner(owner, "owner-test", "1").kind).toBe("configuration-error");
    expect(decideOwner(owner, "owner-test", "true").kind).toBe("configuration-error");
  });
  it("후보 등록은 만료·기존 소유자 설정 시 닫히며 권한 부여로 연결되지 않는다", () => {
    expect(enrollmentEnabled(undefined, "2026-10-24T00:30:00Z", Date.parse("2026-10-24T00:00:00Z"))).toBe(true);
    expect(enrollmentEnabled("owner-test", "2026-10-24T00:30:00Z", 0)).toBe(false);
    expect(enrollmentEnabled(undefined, undefined, 0)).toBe(false);
    expect(enrollmentEnabled(undefined, "2026-10-24T00:30:00Z", Date.parse("2026-10-24T00:30:00Z"))).toBe(false);
    expect(() => enrollmentEnabled(undefined, "invalid", 0)).toThrow(/ALTER_OWNER_ENROLLMENT_EXPIRES_AT/);
    expect(decideOwner(owner, undefined, undefined).kind).toBe("configuration-error");
  });
});

describe("인증 이동과 파일 경로", () => {
  it.each(["/", "/learn", "/learn/materials", "/setup", "/learn?storage=passed", "/learn#main"])("허용 경로를 보존한다: %s", (path) => expect(requireReturnPath(path)).toBe(path));
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/%2f%2fevil.test", "/%252f%252fevil.test", "/learn/../callback", "/learn/materials/../callback", "/callback", "/signin-with-chatgpt", "/signout-with-chatgpt", "/api/google/oauth/callback", "/learn\n", "/unknown"])("위험한 경로를 명시적으로 거부한다: %s", (path) => expect(() => requireReturnPath(path)).toThrow(TypeError));
  it("Origin 부재·다른 출처·잘못된 서버 출처를 거부한다", () => {
    expect(() => requireSameOrigin("https://alter.test", "https://alter.test")).not.toThrow();
    expect(() => requireSameOrigin(null, "https://alter.test")).toThrow(DOMException);
    expect(() => requireSameOrigin("https://evil.test", "https://alter.test")).toThrow(DOMException);
    expect(() => requireSameOrigin("https://alter.test", undefined)).toThrow(TypeError);
    expect(() => requireSameOrigin("https://alter.test", "https://alter.test/path")).toThrow(TypeError);
  });
  it("UUID 외에 직접 R2 키와 경로 이동을 허용하지 않는다", () => {
    expect(privateFileKey("2098834d-60e9-4e33-a856-b381fbca16ef")).toBe("private/2098834d-60e9-4e33-a856-b381fbca16ef");
    for (const id of ["../secret", "diagnostics/id", "%2e%2e", "", "private/id"]) expect(() => privateFileKey(id)).toThrow(TypeError);
  });
});

describe("설정과 입력의 경계", () => {
  it("Google와 AI 누락 오류에 이름만 표시하며 임의 제공사를 사용하지 않는다", () => {
    expect(() => requireGoogleSettings({})).toThrow("GOOGLE_CLIENT_ID");
    expect(() => requireGoogleSettings({ GOOGLE_CLIENT_ID: "id" })).toThrow("GOOGLE_CLIENT_SECRET");
    expect(() => requireGoogleSettings({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret-value" })).toThrow("GOOGLE_TOKEN_ENCRYPTION_KEY");
    expect(() => requireOpenAIKey({})).toThrow("OPENAI_API_KEY");
  });
  it("실제 스트림이 선언 길이보다 크거나 작으면 중단한다", async () => {
    const exact = new Response(new Uint8Array([1, 2, 3])).body;
    expect(new Uint8Array(await readBoundedBody(exact, 3, 4))).toEqual(new Uint8Array([1, 2, 3]));
    await expect(readBoundedBody(new Response(new Uint8Array([1, 2, 3])).body, 2, 4)).rejects.toThrow(RangeError);
    await expect(readBoundedBody(new Response(new Uint8Array([1])).body, 2, 4)).rejects.toThrow(RangeError);
    await expect(readBoundedBody(null, 1, 4)).rejects.toThrow(RangeError);
    await expect(readBoundedBody(new Response("a").body, 10, 4)).rejects.toThrow(RangeError);
  });
});
