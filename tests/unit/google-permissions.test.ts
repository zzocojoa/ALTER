import { describe, expect, it } from "vitest";
import { recordId } from "../../lib/domain/contracts.ts";
import { googleRequestedScopes, parseGoogleGrantedScopes, requireGoogleMethodScope, requireGoogleResourceGrant } from "../../lib/google/permissions.ts";
import type { GoogleMethod, GoogleResourceGrant } from "../../lib/google/permissions.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const grant: GoogleResourceGrant = { ownerId: "owner", connectionId: recordId.parse("00000000-0000-4000-a000-000000001400"), generation: 1, role: "reference", externalId: "selected-file", appCreated: false, approvedAt: now, checkedAt: now, validUntil: now + 60_000 };
function check(value: GoogleResourceGrant, method: GoogleMethod, target: string | null): void { requireGoogleResourceGrant(value, "owner", grant.connectionId, 1, method, googleRequestedScopes, target, now); }

describe("Google 최소 scope와 자원 역할", () => {
  it("신원 scope를 자료 scope와 분리하고 부분 동의를 기능별로 검사한다", () => {
    expect(parseGoogleGrantedScopes("openid https://www.googleapis.com/auth/userinfo.email")).toEqual(["openid", "email"]);
    expect(() => requireGoogleMethodScope("drive.about.get", ["openid", "email"])).toThrow();
    expect(() => requireGoogleMethodScope("docs.documents.create", googleRequestedScopes.filter(scope => !scope.includes("calendar")))).not.toThrow();
    expect(() => requireGoogleMethodScope("calendar.events.get", googleRequestedScopes.filter(scope => !scope.includes("calendar")))).toThrow();
  });
  it("전체 Drive·기본 Calendar 권한과 미확인 메서드로 우회하지 않는다", () => {
    for (const raw of ["", "openid", "email", "openid email https://www.googleapis.com/auth/drive", "openid email https://www.googleapis.com/auth/calendar", "openid email profile"]) expect(() => parseGoogleGrantedScopes(raw)).toThrow();
    expect(() => requireGoogleMethodScope("calendar.acl.insert" as GoogleMethod, googleRequestedScopes)).toThrow();
  });
  it("선택 참고 자료 읽기는 허용하지만 쓰기나 다른 파일은 거부한다", () => {
    expect(() => check(grant, "docs.documents.get", grant.externalId)).not.toThrow();
    expect(() => check(grant, "docs.documents.batchUpdate", grant.externalId)).toThrow();
    expect(() => check(grant, "docs.documents.get", "unselected-file")).toThrow();
    expect(() => check({ ...grant, role: "selection-candidate" }, "docs.documents.get", grant.externalId)).toThrow();
    expect(() => check({ ...grant, role: "selection-candidate" }, "drive.files.get", grant.externalId)).not.toThrow();
  });
  it("소유자·연결 세대·접근 재확인 기한이 바뀌면 기존 승인도 거부한다", () => {
    for (const change of [{ ownerId: "other" }, { connectionId: recordId.parse("00000000-0000-4000-a000-000000001401") }, { generation: 2 }, { validUntil: now }, { validUntil: now + 60_001 }, { checkedAt: now + 1 }, { approvedAt: now + 1 }]) expect(() => check({ ...grant, ...change }, "drive.files.get", grant.externalId)).toThrow();
  });
  it("Docs와 Sheets 쓰기 대상은 서로 교환할 수 없다", () => {
    expect(() => check({ ...grant, role: "docs-target" }, "docs.documents.batchUpdate", grant.externalId)).not.toThrow();
    expect(() => check({ ...grant, role: "docs-target" }, "sheets.values.append", grant.externalId)).toThrow();
    expect(() => check({ ...grant, role: "sheets-target" }, "sheets.values.append", grant.externalId)).not.toThrow();
  });
  it("기본·타 앱 캘린더와 임의 URL은 거부한다", () => {
    const calendar: GoogleResourceGrant = { ...grant, role: "calendar-target", appCreated: true, externalId: "alter-calendar@group.calendar.google.com" };
    expect(() => check(calendar, "calendar.events.insert", calendar.externalId)).not.toThrow();
    expect(() => check({ ...calendar, appCreated: false }, "calendar.events.insert", calendar.externalId)).toThrow();
    expect(() => check({ ...calendar, externalId: "primary" }, "calendar.events.get", "primary")).toThrow();
    expect(() => check({ ...grant, externalId: "https://evil.test/file" }, "drive.files.get", "https://evil.test/file")).toThrow();
  });
  it("생성은 별도 승인으로만 실행하며 파일 승인으로 승격하지 않는다", () => {
    expect(() => check(grant, "docs.documents.create", grant.externalId)).toThrow();
    expect(() => check({ ...grant, role: "docs-create", externalId: null }, "docs.documents.create", null)).not.toThrow();
    expect(() => check({ ...grant, role: "docs-create", externalId: null }, "docs.documents.batchUpdate", null)).toThrow();
  });
});
