import { describe, expect, it } from "vitest";
import { googleApis, requireGoogleProject, requireGoogleStorage } from "../../lib/google/project.ts";
import type { GoogleApi, GoogleProjectEvidence, GoogleStorageEvidence } from "../../lib/google/project.ts";
import { fixtureGoogleProject, fixtureGoogleStorage } from "../fixtures/google-project.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const project: GoogleProjectEvidence = fixtureGoogleProject(now);
const storage: GoogleStorageEvidence = fixtureGoogleStorage(now);
function checkProject(value: GoogleProjectEvidence): GoogleProjectEvidence { return requireGoogleProject(value, "owner", "alter-fixture", googleApis, now); }
function checkStorage(value: GoogleStorageEvidence, reserved: string, required: string): void { requireGoogleStorage(value, "owner", "alter-fixture", "google-subject", reserved, required, now); }

describe("Google 실제 프로젝트와 무료 조건", () => {
  it("검증된 프로젝트만 허용하며 원본을 변경하지 않는다", () => {
    const before: string = JSON.stringify(project);
    expect(checkProject(project)).toEqual(project);
    expect(JSON.stringify(project)).toBe(before);
    expect(checkProject(project)).not.toBe(project);
  });
  it.each(["owner", "project", "console", "expiry", "future", "long-lived"])("%s 증거 불일치를 거부한다", (condition: string) => {
    const changed: GoogleProjectEvidence = { ...project, ...(condition === "owner" ? { ownerId: "other" } : condition === "project" ? { projectId: "other-project" } : condition === "console" ? { consoleSource: "https://console.cloud.google.com/apis/dashboard?project=other-project" } : condition === "expiry" ? { validUntil: now } : condition === "future" ? { checkedAt: now + 1 } : { validUntil: now + 86_400_001 }) };
    expect(() => checkProject(changed)).toThrow(expect.objectContaining({ code: "google_project_unverified" }));
  });
  it.each(googleApis)("%s 비활성화와 미확인을 구별하되 모두 호출을 막는다", (api: GoogleApi) => {
    for (const enabled of [false, null]) expect(() => checkProject({ ...project, apis: { ...project.apis, [api]: { ...project.apis[api], enabled } } })).toThrow(expect.objectContaining({ code: "google_api_disabled", operation: api }));
  });
  it("필요하지 않은 API는 별도 기능을 막지 않으며 빈 요청은 거부한다", () => {
    const partial: GoogleProjectEvidence = { ...project, apis: { ...project.apis, calendar: { ...project.apis.calendar, enabled: false } } };
    expect(() => requireGoogleProject(partial, "owner", "alter-fixture", ["drive"], now)).not.toThrow();
    expect(() => requireGoogleProject(partial, "owner", "alter-fixture", [], now)).toThrow();
    expect(() => requireGoogleProject(partial, "owner", "alter-fixture", ["drive", "drive"], now)).toThrow();
  });
  it("무료 미확인·유료 확대·실제 한도 미확인은 허용하지 않는다", () => {
    expect(() => checkProject({ ...project, paidQuotaExpansion: "enabled" })).toThrow(expect.objectContaining({ code: "google_free_conditions_unverified" }));
    expect(() => checkProject({ ...project, paidQuotaExpansion: "unknown" })).toThrow();
    expect(() => checkProject({ ...project, billingAccountLinked: null })).toThrow();
    for (const change of [{ freeWithinVerifiedLimits: null }, { freeWithinVerifiedLimits: false }, { limitsVerified: false }, { validUntil: now }]) expect(() => checkProject({ ...project, apis: { ...project.apis, drive: { ...project.apis.drive, ...change } } })).toThrow(expect.objectContaining({ code: "google_free_conditions_unverified" }));
  });
  it("잘못된 근거 URL과 미등록 필드는 설정 오류로만 응답한다", () => {
    expect(() => checkProject({ ...project, consoleSource: "https://console.cloud.google.com.evil.example/?project=alter-fixture" })).toThrow(expect.objectContaining({ code: "google_configuration_invalid" }));
    expect(() => checkProject({ ...project, consoleSource: "https://secret@console.cloud.google.com/?project=alter-fixture" })).toThrow();
    expect(() => checkProject({ ...project, secret: "do-not-print" } as GoogleProjectEvidence)).toThrow(expect.not.objectContaining({ message: expect.stringContaining("do-not-print") }));
  });
});

describe("Google 계정 저장 용량과 진행 중인 예약", () => {
  it("사용량과 예약을 합산하며 정확한 경계까지만 허용한다", () => {
    expect(() => checkStorage(storage, "1000000000", "13000000000")).not.toThrow();
    expect(() => checkStorage(storage, "1000000000", "13000000001")).toThrow(expect.objectContaining({ code: "google_storage_exhausted" }));
    expect(() => checkStorage(storage, "14000000000", "0")).toThrow();
  });
  it("계정·프로젝트·소유자·만료·누락을 미확인으로 차단한다", () => {
    for (const change of [{ googleSubject: "different" }, { projectId: "different-project" }, { ownerId: "different" }, { validUntil: now }, { limitBytes: null }, { usedBytes: null }, { state: "unknown" as const }]) expect(() => checkStorage({ ...storage, ...change }, "0", "0")).toThrow(expect.objectContaining({ code: "google_storage_unverified" }));
  });
  it("무제한·안전 정수 초과를 임의 추정하지 않고 int64 문자열을 정확히 계산한다", () => {
    const large: GoogleStorageEvidence = { ...storage, limitBytes: "9223372036854775807", usedBytes: "9223372036854775806" };
    expect(() => checkStorage(large, "0", "1")).not.toThrow();
    expect(() => checkStorage(large, "0", "2")).toThrow();
    expect(() => checkStorage({ ...storage, limitBytes: "9223372036854775808" }, "0", "1")).toThrow(expect.objectContaining({ code: "google_configuration_invalid" }));
    for (const invalid of ["-1", "1.5", "1e3", "01"]) expect(() => checkStorage(storage, invalid, "0")).toThrow();
  });
  it("AI 비용이나 충전 설정 없이 이미 확인된 Google 조건을 판단한다", () => {
    expect(() => checkStorage(storage, "0", "0")).not.toThrow();
    expect(() => checkProject(project)).not.toThrow();
  });
});
