import { describe, expect, it } from "vitest";
import { backupCatalog } from "../../lib/backup/catalog";
import { restoreTableOrder } from "../../lib/backup/restore-order";
import { projectRestoreRow } from "../../lib/backup/restore-projection";
import type { BackupRow } from "../../lib/backup/contracts";
import { preflightFixtureRows, originalEntry, backupFixtureOwner, backupFixtureId } from "../fixtures/backup-files";

const target: string = "new-confirmed-owner";
const mapping = { entry: originalEntry, objectVersion: "restored-version", etag: "restored-etag" };
function job(): BackupRow { return { owner_id: backupFixtureOwner, id: originalEntry.materialId, version: 3, last_request_id: backupFixtureId(99), upload_id: originalEntry.uploadId, selection: JSON.stringify({ materialId: originalEntry.materialId, originalVersion: originalEntry.objectVersion, originalHash: originalEntry.sha256, pages: [{ filePage: 1, purpose: "study" }] }), updated_at: 3 }; }

describe("과거 기록 복원의 명시적 변환", () => {
  it("모든 외래 키 부모와 정적 검사 부모를 자식보다 먼저 배치한다", () => {
    const ordered = restoreTableOrder(); expect(new Set(ordered).size).toBe(backupCatalog.length);
    for (const table of backupCatalog) for (const reference of table.references) if (reference.table !== table.name) expect(ordered.indexOf(reference.table as typeof table.name)).toBeLessThan(ordered.indexOf(table.name));
    expect(ordered.indexOf("corrections")).toBeLessThan(ordered.indexOf("confirmed_results"));
    expect(ordered.indexOf("uploads")).toBeLessThan(ordered.indexOf("material_files"));
  });
  it("자유 입력 속 소유자 문자열과 원본 입력은 수정하지 않는다", () => {
    const input = { ...preflightFixtureRows().courses![0], title: backupFixtureOwner }; const snapshot: string = JSON.stringify(input);
    expect(projectRestoreRow("courses", input, backupFixtureOwner, target, null)).toEqual({ ...input, owner_id: target }); expect(JSON.stringify(input)).toBe(snapshot);
    expect(() => projectRestoreRow("courses", input, "other-source", target, null)).toThrow(/owner-mismatch/);
  });
  it("검증된 원본 버전과 etag만 전송 검증 결과에 연결한다", () => {
    const input = preflightFixtureRows().material_transfers![0]; const result = projectRestoreRow("material_transfers", input, backupFixtureOwner, target, mapping);
    expect(result).toMatchObject({ object_version: mapping.objectVersion, etag: mapping.etag, actual_hash: originalEntry.sha256 });
    expect(JSON.parse(String(result.validation))).toMatchObject({ objectVersion: mapping.objectVersion, etag: mapping.etag, sha256: originalEntry.sha256 });
    expect(() => projectRestoreRow("material_transfers", input, backupFixtureOwner, target, null)).toThrow(/original-missing/);
    expect(() => projectRestoreRow("material_transfers", { ...input, etag: "different" }, backupFixtureOwner, target, mapping)).toThrow(/projection-transfer/);
  });
  it("선택 페이지와 용도를 유지하고 오래된 원본을 임의로 새 버전에 연결하지 않는다", () => {
    const input = job(); const result = projectRestoreRow("extraction_jobs", input, backupFixtureOwner, target, mapping);
    expect(JSON.parse(String(result.selection))).toMatchObject({ originalVersion: mapping.objectVersion, pages: [{ filePage: 1, purpose: "study" }] });
    const stale = { ...input, selection: String(input.selection).replace('"v1"', '"old"') };
    expect(() => projectRestoreRow("extraction_jobs", stale, backupFixtureOwner, target, mapping)).toThrow(/projection-selection/);
  });
  it("추출 결과의 본문과 불변 ID를 보존하고 원본 버전 열만 연결한다", () => {
    const input = { owner_id: backupFixtureOwner, id: backupFixtureId(10), page_id: backupFixtureId(11), result_version: 3, upload_id: originalEntry.uploadId, original_version: originalEntry.objectVersion, original_hash: originalEntry.sha256, result: '{"text":"v1"}', image: null, ai_call_id: null, created_at: 3 };
    expect(projectRestoreRow("extraction_results", input, backupFixtureOwner, target, mapping)).toEqual({ ...input, owner_id: target, original_version: mapping.objectVersion });
  });
  it("과거 Google 연결을 새 동의로 취급하지 않는다", () => {
    const input = { owner_id: backupFixtureOwner, id: backupFixtureId(12), version: 4, last_request_id: backupFixtureId(99), google_subject: "historical-subject", scopes: "[]", expires_at: 100000, revoked_at: null, reconnect_required: 0 };
    expect(projectRestoreRow("google_connections", input, backupFixtureOwner, target, null)).toEqual({ ...input, owner_id: target, reconnect_required: 1, expires_at: 0 });
  });
});
