import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as databaseSchema from "../../db/schema";
import { backupCatalog, backupExcludedTables, backupExcludedColumns } from "../../lib/backup/catalog";
import { backupCatalogHash, backupPagePath, projectBackupRow, validateBackupManifest, validateBackupPage, validateBackupRow } from "../../lib/backup/contracts";
import type { BackupManifest, BackupPage, BackupRow } from "../../lib/backup/contracts";
import { containsAuthenticationMaterial } from "../../lib/backup/safety";
import { recordId } from "../../lib/domain/contracts";
import { fixtureFunding, fixturePrepaidProbe } from "../fixtures/ai-funding";
import { fixturePricing } from "../fixtures/ai-pricing";
import { editorReadyFixture } from "../fixtures/editor-state";
import { tutorState } from "../../lib/tutor/contracts";
import { tutorId } from "../fixtures/tutor-state";
const owner = "backup-test-owner";
const hash = "a".repeat(64);
const basis = { sourceProjectId: "fixture-project", ownerId: owner, revision: 12, catalogHash: hash, startedAt: 100 };
const course: BackupRow = { owner_id: owner, id: tutorId(4), version: 1, last_request_id: tutorId(99), title: "분수 학습" };
function coursePage(): BackupPage { return { schemaVersion: 1, backupId: recordId.parse(tutorId(90)), basis, table: "courses", role: "learning", ordinal: 0, cursorBefore: 0, cursorAfter: 1, final: true, rows: [course] }; }
function emptyManifest(): BackupManifest {
  return { schemaVersion: 1, backupId: tutorId(90), state: "complete", basis, completedAt: 101, checksumAlgorithm: "SHA-256", executionAuthority: "none", credentials: "excluded", pages: backupCatalog.map(table => ({ table: table.name, ordinal: 0, path: backupPagePath(table.name, 0), bytes: 200, sha256: hash, count: 0, cursorBefore: 0, cursorAfter: 0, final: true })), objects: [], counts: backupCatalog.map(table => ({ table: table.name, rows: 0 })) };
}
describe("백업 버전·필드·완전성 계약", () => {
  it("현재 DB의 모든 테이블·열·참조를 명시적으로 분류하고 새 필드가 자동 유출되지 않는다", async () => {
    const tables = Object.values(databaseSchema).filter(value => is(value, SQLiteTable)).map(getTableConfig);
    expect(new Set(backupCatalog.map(table => table.name)).size).toBe(backupCatalog.length);
    expect(tables.map(table => table.name).sort()).toEqual([...backupCatalog.map(table => table.name), ...Object.keys(backupExcludedTables)].sort());
    for (const table of tables) {
      const contract = backupCatalog.find(item => item.name === table.name);
      if (!contract) continue;
      const excluded: readonly string[] = table.name === "material_transfers" ? backupExcludedColumns.material_transfers : [];
      expect(contract.columns.map(column => column.name)).toEqual(table.columns.filter(column => !excluded.includes(column.name)).map(column => column.name));
      expect(contract.references).toEqual(table.foreignKeys.map(foreignKey => { const ref = foreignKey.reference(); return { columns: ref.columns.map(column => column.name), table: getTableConfig(ref.foreignTable).name, target: ref.foreignColumns.map(column => column.name) }; }));
    }
    expect(await backupCatalogHash()).toMatch(/^[a-f0-9]{64}$/);
    const source = { ...course, access_token: "test-access-credential", signed_url: "https://example.test/file?signature=test-secret" };
    expect(projectBackupRow("courses", source, owner)).toEqual(course);
    expect(source.access_token).toBe("test-access-credential");
  });
  it("Editor 수정 이유·도움·출처와 노출·확정 수행·지연 재현을 손실 없이 보존한다", () => {
    const state = editorReadyFixture();
    const row = projectBackupRow("tutor_sessions", { owner_id: owner, id: state.id, version: state.version, last_request_id: tutorId(99), scope_id: state.start.scopeId, state: JSON.stringify(state) }, owner);
    expect(tutorState.parse(JSON.parse(row.state as string))).toEqual(state);
    expect(state.editor?.versions.some(version => version.reason === "전체와 부분 구분")).toBe(true);
    const exposure = { owner_id: owner, id: tutorId(81), material_id: tutorId(8), attempt_id: tutorId(13), help_event_id: tutorId(21), shown_at: 100 };
    expect(projectBackupRow("material_exposures", exposure, owner)).toEqual(exposure);
    const result = { owner_id: owner, id: tutorId(82), result_id: tutorId(83), ordinal: 1, answer_id: tutorId(30), progress: "완료", performance: "지연 재현", confirmed_at: 100, correction_id: tutorId(84) };
    expect(projectBackupRow("confirmed_results", result, owner)).toEqual(result);
    const review = { owner_id: owner, id: tutorId(85), version: 3, last_request_id: tutorId(99), error_id: tutorId(86), source_ref_id: tutorId(7), question: "새 조건", explanation: "정정 설명", next_action: "지연 재현", correction_id: tutorId(84), recheck_state: "delayed" };
    expect(projectBackupRow("review_items", review, owner)).toEqual(review);
    expect(backupCatalog.find(table => table.name === "sessions")?.role).toBe("learning");
  });
  it("현재 실행 권한·계정 지문을 제외하고 미확정 비용은 보존 이력으로 유지한다", () => {
    const funding = fixturePrepaidProbe(fixtureFunding(owner, fixturePricing().id, 100), fixturePricing()).funding;
    const row = projectBackupRow("ai_funding_checks", { owner_id: owner, reservation_id: tutorId(50), snapshot: JSON.stringify(funding), checked_at: 100 }, owner);
    expect(JSON.stringify(row)).not.toMatch(/accountFingerprint|reconciledReservationIds/);
    expect(JSON.parse(row.snapshot as string).prepaidProbe.pendingPayment.krwStatus).toBe("pending");
    expect(backupCatalog.find(table => table.name === "ai_funding_checks")?.role).toBe("history-only");
    expect(backupCatalog.find(table => table.name === "external_operations")?.role).toBe("history-only");
    expect(() => validateBackupRow("ai_funding_checks", { ...row, snapshot: JSON.stringify(funding) }, owner)).toThrow(/invalid-field/);
  });
  it("미지원 버전·누락·추가 열·소유자 혼합·중복 ID·커서 불일치를 거부한다", () => {
    expect(validateBackupPage(coursePage())).toEqual(coursePage());
    for (const value of [{ ...coursePage(), schemaVersion: 2 }, { ...coursePage(), rows: [{ ...course, title: undefined }] }, { ...coursePage(), rows: [{ ...course, surprise: "field" }] }, { ...coursePage(), rows: [{ ...course, owner_id: "someone-else" }] }, { ...coursePage(), rows: [course, course], cursorAfter: 2 }, { ...coursePage(), cursorAfter: 0 }]) expect(() => validateBackupPage(value)).toThrow(/백업 검증 실패/);
  });
  it("유효한 완료 매니페스트만 허용하고 누락 페이지·중복 개수·경로 이탈·객체 충돌을 거부한다", () => {
    const manifest = emptyManifest(); expect(validateBackupManifest(manifest, hash)).toEqual(manifest);
    const bad = [{ ...manifest, state: "partial" }, { ...manifest, schemaVersion: 2 }, { ...manifest, pages: manifest.pages.slice(1) }, { ...manifest, counts: [manifest.counts[0], ...manifest.counts.slice(0, -1)] }, { ...manifest, pages: manifest.pages.map((page, i) => i === 0 ? { ...page, path: "../secret.json" } : page) }, { ...manifest, pages: manifest.pages.map((page, i) => i === 0 ? { ...page, final: false } : page) }];
    for (const value of bad) expect(() => validateBackupManifest(value, hash)).toThrow(/백업 검증 실패/);
    expect(() => validateBackupManifest(manifest, "b".repeat(64))).toThrow(/manifest.basis/);
    const object = { materialId: tutorId(8), uploadId: tutorId(9), objectKey: `learning/${tutorId(8)}/${tutorId(9)}/${tutorId(10)}`, path: "objects/000000.bin", bytes: 20, objectVersion: "v1", etag: "etag1", sha256: hash };
    expect(validateBackupManifest({ ...manifest, objects: [object] }, hash).objects).toHaveLength(1);
    for (const objects of [[{ ...object, objectKey: "../outside" }], [{ ...object, objectKey: "https://example.test?signature=test-secret" }], [object, { ...object, path: "objects/000001.bin" }]]) expect(() => validateBackupManifest({ ...manifest, objects }, hash)).toThrow();
  });
  it("중첩 JSON·서명 URL·본문 인증값을 유출하지 않고 고정된 오류 위치만 남긴다", () => {
    const secrets = ['{"access_token":"test-secret-value"}', '{"nested":{"client_secret":"test-secret-value"}}', '{"access\\u005ftoken":"test-secret-value"}', 'https://example.test/file?X-Amz-Signature=test-secret-value', 'https://name:test-secret-value@example.test/', 'Bearer test-secret-value', 'sk-proj-test-secret-value'];
    for (const secret of secrets) {
      expect(containsAuthenticationMaterial(secret)).toBe(true);
      try { projectBackupRow("courses", { ...course, title: secret }, owner); throw new Error("검사가 인증 값을 통과시켰습니다."); } catch (error: unknown) { expect(error).toMatchObject({ name: "BackupFailure", code: "authentication-material", location: "courses.title" }); expect(String(error)).not.toContain("test-secret-value"); }
    }
    expect(containsAuthenticationMaterial(JSON.stringify({ sessionId: tutorId(11), inputTokens: 10, helpIds: [tutorId(21)] }))).toBe(false);
  });
});
