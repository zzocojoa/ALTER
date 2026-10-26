import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { preflightFixtureRows, writeBackupFixture, originalEntry, backupFixtureId } from "../fixtures/backup-files";
import { planRestoreOriginal, requireRestoredOriginalIdentity, restoreOriginalMetadata } from "../../lib/backup/restore-original";
import type { MaterialObjectIdentity } from "../../lib/materials/object";
import type { BackupManifest, BackupPage } from "../../lib/backup/contracts";

let directory: string; let manifest: BackupManifest; let uploads: BackupPage; let transfers: BackupPage;
const input = { ordinal: 0, uploadPage: 0, transferPage: 0 };
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "alter-original-plan-")); manifest = await writeBackupFixture(directory, preflightFixtureRows(), [originalEntry]);
  uploads = JSON.parse(await readFile(path.join(directory, "pages/uploads/000000.json"), "utf8")); transfers = JSON.parse(await readFile(path.join(directory, "pages/material_transfers/000000.json"), "utf8"));
});
afterAll(async () => { await rm(directory, { recursive: true, force: false }); });

describe("복원 원본의 근거와 객체 대응", () => {
  it("전송 ID와 실제 업로드 ID를 구분하며 원래 파일 키와 MIME을 보존한다", () => {
    const plan = planRestoreOriginal(manifest, input, uploads, transfers); expect(plan.entry.uploadId).toBe(backupFixtureId(4)); expect(plan.originalUploadId).toBe(backupFixtureId(5));
    expect(restoreOriginalMetadata(backupFixtureId(100), plan)).toMatchObject({ onlyIf: { etagDoesNotMatch: "*" }, httpMetadata: { contentType: "text/plain" }, customMetadata: { alterTransferId: backupFixtureId(4), alterUploadId: backupFixtureId(5), alterRestoreRunId: backupFixtureId(100) } });
  });
  it("정리되지 않은 전송·누락된 원본·해시 불일치를 거부한다", () => {
    expect(() => planRestoreOriginal(manifest, { ...input, ordinal: 1 }, uploads, transfers)).toThrow(/original-key/);
    expect(() => planRestoreOriginal(manifest, input, uploads, { ...transfers, rows: [{ ...transfers.rows[0], state: "stored" }] })).toThrow(/original-facts/);
    expect(() => planRestoreOriginal(manifest, input, { ...uploads, rows: [{ ...uploads.rows[0], expected_hash: "0".repeat(64) }] }, transfers)).toThrow(/original-facts/);
  });
  it("원본 파일로 내부 복원 메타데이터 경로를 덮어쓸 수 없다", () => {
    expect(() => planRestoreOriginal({ ...manifest, objects: [{ ...originalEntry, objectKey: ".alter/storage-identity-v1.json" }] }, input, uploads, transfers)).toThrow(/original-key/);
  });
  it("복원 런·바이트 수·MIME·모든 원본 식별자를 실제 R2 관측에 묶는다", () => {
    const plan = planRestoreOriginal(manifest, input, uploads, transfers); const runId: string = backupFixtureId(100); const metadata = restoreOriginalMetadata(runId, plan);
    const object: MaterialObjectIdentity = { key: originalEntry.objectKey, size: originalEntry.bytes, version: "new-version", etag: "new-etag", httpMetadata: { contentType: plan.mime }, customMetadata: metadata.customMetadata };
    expect(() => requireRestoredOriginalIdentity(object, runId, plan)).not.toThrow();
    expect(() => requireRestoredOriginalIdentity({ ...object, customMetadata: { ...object.customMetadata, alterRestoreRunId: "other" } }, runId, plan)).toThrow(/original-identity/);
    expect(() => requireRestoredOriginalIdentity({ ...object, size: object.size + 1 }, runId, plan)).toThrow(/original-identity/);
  });
});
