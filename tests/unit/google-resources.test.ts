import { describe, expect, it } from "vitest";
import { verifyGoogleFile, verifiedGoogleResourceGrant } from "../../lib/google/resources.ts";
import { googleRequestedScopes, requireGoogleResourceGrant } from "../../lib/google/permissions.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const id: string = "00000000-0000-4000-a000-000000001400";
const metadata = { id: "selected-doc", name: "선택한 문서", mimeType: "application/vnd.google-apps.document", trashed: false, isAppAuthorized: true, modifiedTime: "2026-10-25T00:00:00Z", capabilities: { canEdit: true } };
describe("선택 Google 자원 경계", () => {
  it("서버 메타데이터와 역할을 확인하고 참고 자료를 쓰기 대상으로 승격하지 않는다", () => {
    const file = verifyGoogleFile(metadata, metadata.id, "reference", now);
    const grant = verifiedGoogleResourceGrant("owner", id, 1, now, false, file, now);
    expect(() => requireGoogleResourceGrant(grant, "owner", id, 1, "docs.documents.get", googleRequestedScopes, metadata.id, now)).not.toThrow();
    expect(() => requireGoogleResourceGrant(grant, "owner", id, 1, "docs.documents.batchUpdate", googleRequestedScopes, metadata.id, now)).toThrow();
  });
  it("위조·삭제·공유 미승인·바로가기·쓰기 불가·잘못된 유형을 거부한다", () => {
    for (const change of [{ id: "other" }, { trashed: true }, { isAppAuthorized: false }, { mimeType: "application/vnd.google-apps.shortcut" }, { capabilities: { canEdit: false } }, { mimeType: "application/vnd.google-apps.spreadsheet" }]) expect(() => verifyGoogleFile({ ...metadata, ...change }, metadata.id, "docs-target", now)).toThrow();
    expect(() => verifyGoogleFile(metadata, "https://evil.test", "reference", now)).toThrow();
    expect(() => verifyGoogleFile({ id: metadata.id, canEdit: true }, metadata.id, "reference", now)).toThrow();
  });
  it("오래된 확인 결과와 다른 연결의 권한을 재사용하지 않는다", () => {
    const file = verifyGoogleFile(metadata, metadata.id, "docs-target", now);
    expect(() => verifiedGoogleResourceGrant("owner", id, 1, now, false, file, now + 60_000)).toThrow();
    const grant = verifiedGoogleResourceGrant("owner", id, 1, now, false, file, now);
    expect(() => requireGoogleResourceGrant(grant, "other", id, 1, "docs.documents.get", googleRequestedScopes, metadata.id, now)).toThrow();
    expect(() => requireGoogleResourceGrant(grant, "owner", id, 2, "docs.documents.get", googleRequestedScopes, metadata.id, now)).toThrow();
  });
});
