import { describe, expect, it } from "vitest";
import { selectBackupRows, encodeBackupPage } from "../../lib/backup/pagination";
import { backupPolicy } from "../../lib/backup/contracts";
import { recordId } from "../../lib/domain/contracts";
import { createHash } from "node:crypto";

describe("D1 백업 페이지 크기와 파일 해시", () => {
  it("행 수·UTF-8 직렬화 크기로 본문 조회 전에 범위를 제한한다", () => {
    const sizes = Array.from({ length: 33 }, (_, index) => ({ cursor: index + 1, bytes: 128 }));
    expect(selectBackupRows(sizes)).toEqual({ cursors: sizes.slice(0, 32).map(row => row.cursor), final: false });
    expect(selectBackupRows(sizes.slice(0, 32)).final).toBe(true);
    expect(selectBackupRows([])).toEqual({ cursors: [], final: true });
    expect(selectBackupRows([{ cursor: 1, bytes: 2_500_000 }, { cursor: 2, bytes: 2_500_000 }])).toEqual({ cursors: [1], final: false });
    expect(() => selectBackupRows([{ cursor: 1, bytes: backupPolicy.maximumPageBytes }])).toThrow(/page-too-large/);
    expect(() => selectBackupRows([{ cursor: 1, bytes: 1 }, { cursor: 1, bytes: 1 }])).toThrow(/invalid-page/);
  });
  it("한국어·제어 문자가 포함된 실제 파일 바이트와 해시를 일치시킨다", async () => {
    const page = await encodeBackupPage({ schemaVersion: 1, backupId: recordId.parse("00000000-0000-4000-8000-000000000001"), basis: { sourceProjectId: "project", ownerId: "owner", revision: 3, catalogHash: "a".repeat(64), startedAt: 1 }, table: "courses", role: "learning", ordinal: 0, cursorBefore: 0, cursorAfter: 1, final: true, rows: [{ owner_id: "owner", id: "course", version: 1, last_request_id: "request", title: "커피\n학습\u0001" }] });
    expect(page.entry.bytes).toBe(Buffer.byteLength(page.json, "utf8"));
    expect(page.entry.sha256).toBe(createHash("sha256").update(page.json).digest("hex"));
    expect(JSON.parse(page.json)).toEqual(page.page);
  });
});
