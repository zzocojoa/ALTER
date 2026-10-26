import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { writeBackupFixture, backupFixtureId, originalEntry } from "../fixtures/backup-files";
import { backupTextHash } from "../../lib/backup/pagination";
import { restoreAuthorization } from "../../lib/backup/restore-authority";
import type { RestoreAuthorization } from "../../lib/backup/restore-authority";
import { restoreDocumentKey, validateRestoreManifestDocument, validateRestorePageDocument } from "../../lib/backup/restore-document";
import type { BackupManifest } from "../../lib/backup/contracts";
import { readBoundedJsonDocument } from "../../lib/materials/request";

let directory: string; let manifest: BackupManifest; let text: string; let authorization: RestoreAuthorization;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "alter-restore-document-")); manifest = await writeBackupFixture(directory, {}, []); text = await readFile(path.join(directory, "manifest.json"), "utf8");
  authorization = restoreAuthorization.parse({ version: 1, purpose: "isolated-backup-restore", challenge: { id: backupFixtureId(110), target: { projectId: "isolated-target", databaseId: backupFixtureId(111), bucketId: backupFixtureId(112), owner: { realm: "sites", userId: "target-owner" }, purpose: "restore-test" }, issuedAt: 100, expiresAt: 200 }, source: { projectId: manifest.basis.sourceProjectId, databaseId: backupFixtureId(113), bucketId: backupFixtureId(114), owner: { realm: "sites", userId: manifest.basis.ownerId }, purpose: "primary" }, backupId: manifest.backupId, manifestSha256: await backupTextHash(text), issuedAt: 100, expiresAt: 200, restoredExecutionAuthority: "none", googleConsent: "required" });
});
afterAll(async () => { await rm(directory, { recursive: true, force: false }); });

describe("서명된 복원 문서의 수신 계약", () => {
  it("페이지·원본·매니페스트·고정 표식 용량을 모두 합산한다", async () => {
    const result = await validateRestoreManifestDocument(text, authorization);
    expect(result.reservedBytes).toBe(Buffer.byteLength(text) + 3072 + manifest.pages.reduce((n, entry) => n + entry.bytes, 0));
    expect(result.fact.sha256).toBe(authorization.manifestSha256);
  });
  it("공백 변경과 동일 해시에 붙인 다른 원본 소유자 또는 프로젝트를 거부한다", async () => {
    await expect(validateRestoreManifestDocument(text + " ", authorization)).rejects.toMatchObject({ code: "wrong-backup" });
    await expect(validateRestoreManifestDocument(text, { ...authorization, source: { ...authorization.source, projectId: "another-source" } })).rejects.toMatchObject({ code: "wrong-backup" });
    await expect(validateRestoreManifestDocument(text, { ...authorization, source: { ...authorization.source, owner: { realm: "sites", userId: "other" } } })).rejects.toMatchObject({ code: "wrong-backup" });
  });
  it("원본만 256MiB인 백업은 부가 문서 용량 때문에 거부한다", async () => {
    const oversized: string = JSON.stringify({ ...manifest, objects: [{ ...originalEntry, bytes: 268435456 }] });
    await expect(validateRestoreManifestDocument(oversized, { ...authorization, manifestSha256: await backupTextHash(oversized) })).rejects.toMatchObject({ location: "restore.application-capacity" });
  });
  it("선언된 페이지 원문만 허용하며 커서·해시 변경이나 미선언 경로를 거부한다", async () => {
    const entry = manifest.pages[0]; const page: string = await readFile(path.join(directory, entry.path), "utf8");
    expect((await validateRestorePageDocument(page, manifest, entry.path)).fact.sha256).toBe(entry.sha256);
    await expect(validateRestorePageDocument(page + " ", manifest, entry.path)).rejects.toMatchObject({ location: "restore.page-manifest" });
    await expect(validateRestorePageDocument(page, manifest, "pages/courses/009999.json")).rejects.toMatchObject({ location: "restore.undeclared-page" });
    expect(() => restoreDocumentKey(backupFixtureId(10), "../secret")).toThrow(/restore.path/);
  });
  it("HTTP JSON 읽기가 UTF-8 원문을 보존하고 바이트 상한·선언 길이를 확인한다", async () => {
    const raw: string = ' {"문서": "검증"} \n';
    const make = (length: string): Request => new Request("https://restore.test", { method: "PUT", headers: { "content-type": "application/json", "content-length": length }, body: raw });
    expect((await readBoundedJsonDocument(make(String(Buffer.byteLength(raw))), 100)).text).toBe(raw);
    await expect(readBoundedJsonDocument(make("1"), 100)).rejects.toMatchObject({ field: "json-length-mismatch" });
    await expect(readBoundedJsonDocument(make(String(Buffer.byteLength(raw))), 5)).rejects.toMatchObject({ field: "json-length" });
  });
});
