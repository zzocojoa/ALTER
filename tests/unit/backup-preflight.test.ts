import { mkdtemp, rm, readFile, writeFile, symlink, link, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectBackupFile, hashBackupFile, backupRoot } from "../../scripts/backup/files";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preflightBackup } from "../../scripts/backup/preflight";
import { backupFixtureId, originalEntry, preflightFixtureRows, writeBackupFixture } from "../fixtures/backup-files";
import type { FixtureRows } from "../fixtures/backup-files";
import { tutorId } from "../fixtures/tutor-state";
import { editorReadyFixture } from "../fixtures/editor-state";

const folders: string[] = [];
async function directory(): Promise<string> { const folder: string = await mkdtemp(path.join(tmpdir(), "alter-preflight-test-")); folders.push(folder); return folder; }
afterEach(async () => { vi.unstubAllGlobals(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: false }); });
async function rejectRows(rows: FixtureRows, code: string): Promise<void> { const root = await directory(); await writeBackupFixture(root, rows, [originalEntry]); await expect(preflightBackup(root)).rejects.toMatchObject({ issue: { code } }); }
describe("복원 전 읽기 전용 백업 검증", () => {
  it("과정부터 출처·원본까지 검사하고 소유자/Google은 승인 후보로만 반환한다", async () => {
    const root = await directory(); await writeBackupFixture(root, preflightFixtureRows(), [originalEntry]);
    const network = vi.fn(() => { throw new Error("외부 호출 금지"); }); vi.stubGlobal("fetch", network);
    const result = await preflightBackup(root);
    expect(result).toMatchObject({ status: "passed", authority: "preflight-only", objects: 1, targetWrites: 0, providerCalls: 0, googleConnection: "requires-new-consent", ownerRemapping: "requires-server-confirmed-source-and-target" });
    expect(result.historyTables).toContain("external_operations"); expect(network).not.toHaveBeenCalled();
    expect((await readFile(path.join(root, "manifest.json"), "utf8"))).toContain('"credentials":"excluded"');
  });
  it("해시만 다른 JSON과 원본 손상·길이 부족을 거부한다", async () => {
    for (const filename of ["pages/courses/000000.json", "objects/000000.bin"]) {
      const root = await directory(); await writeBackupFixture(root, preflightFixtureRows(), [originalEntry]);
      const original: Buffer = await readFile(path.join(root, filename)); await writeFile(path.join(root, filename), original.subarray(1));
      await expect(preflightBackup(root)).rejects.toMatchObject({ issue: { code: filename.startsWith("pages") ? "invalid-json" : "checksum-mismatch" } });
    }
    const root = await directory(); await writeBackupFixture(root, preflightFixtureRows(), [originalEntry]);
    const filename = path.join(root, "pages/courses/000000.json"); await writeFile(filename, (await readFile(filename, "utf8")).replace("검증 과정", "손상 과정"));
    await expect(preflightBackup(root)).rejects.toMatchObject({ issue: { code: "checksum-mismatch" } });
  });
  it("누락·추가 파일과 추가 페이지를 거부한다", async () => {
    for (const name of ["missing", "extra", "page"]) {
      const root = await directory(); await writeBackupFixture(root, preflightFixtureRows(), [originalEntry]);
      if (name === "missing") await rm(path.join(root, "objects/000000.bin"));
      else await writeFile(path.join(root, name === "extra" ? "objects/000001.bin" : "pages/courses/000001.json"), "extra");
      await expect(preflightBackup(root)).rejects.toMatchObject({ issue: { code: "file-set" } });
    }
  });
  it("미지원 스키마·미완료·경로 이탈·객체 충돌을 거부한다", async () => {
    for (const kind of ["schema", "state", "path", "object-key"]) {
      const root = await directory(); const manifest = await writeBackupFixture(root, preflightFixtureRows(), [originalEntry]);
      const bad = kind === "schema" ? { ...manifest, schemaVersion: 2 } : kind === "state" ? { ...manifest, state: "database-ready" } : kind === "path" ? { ...manifest, pages: manifest.pages.map((page, i) => i === 0 ? { ...page, path: "../../outside" } : page) } : { ...manifest, objects: [originalEntry, { ...originalEntry, uploadId: backupFixtureId(88), path: "objects/000001.bin" }] };
      await writeFile(path.join(root, "manifest.json"), JSON.stringify(bad)); await expect(preflightBackup(root)).rejects.toMatchObject({ issue: { code: "invalid-manifest" } });
    }
  });
  it("페이지 사이 중복 ID와 누락 필드·혼합 소유자를 거부한다", async () => {
    const rows = preflightFixtureRows(); const course = rows.courses![0];
    await rejectRows({ ...rows, courses: [course, course] }, "duplicate-key");
    await rejectRows({ ...rows, courses: [{ ...course, owner_id: "other-owner" }] }, "invalid-page");
    const { title, ...missing } = course; expect(title).toBeDefined();
    await rejectRows({ ...rows, courses: [missing] }, "invalid-page");
  });
  it("끊어진 과정·출처·객체 버전 참조와 등록 미확정을 거부한다", async () => {
    const rows = preflightFixtureRows();
    await rejectRows({ ...rows, units: [{ ...rows.units![0], course_id: backupFixtureId(88) }] }, "missing-reference");
    await rejectRows({ ...rows, source_references: [{ ...rows.source_references![0], page_id: backupFixtureId(88) }] }, "missing-reference");
    await rejectRows({ ...rows, uploads: [{ ...rows.uploads![0], object_key: "learning/wrong-object" }] }, "missing-reference");
    await rejectRows({ ...rows, material_transfers: [{ ...rows.material_transfers![0], object_version: "replaced" }] }, "object-mismatch");
    await rejectRows({ ...rows, material_transfers: [{ ...rows.material_transfers![0], state: "unknown" }] }, "unsettled-upload");
    await rejectRows({ ...rows, material_transfers: [{ ...rows.material_transfers![0], state: "discarded" }] }, "missing-reference");
    await rejectRows({ ...rows, material_transfers: [{ ...rows.material_transfers![0], metadata: "{}" }] }, "invalid-state");
  });
  it("백업 파일의 심볼릭 링크와 하드링크를 읽지 않는다", async () => {
    for (const kind of ["symbolic", "hard"]) {
      const root = await directory(); await writeBackupFixture(root, preflightFixtureRows(), [originalEntry]); const external = await directory(); const filename = path.join(root, "objects/000000.bin");
      await writeFile(path.join(external, "data"), "outside"); await rm(filename);
      if (kind === "symbolic") await symlink(path.join(external, "data"), filename); else await link(path.join(external, "data"), filename);
      await expect(preflightBackup(root)).rejects.toMatchObject({ issue: { code: kind === "symbolic" ? "unsafe-path" : "unsafe-file" } });
    }
  });
  it("불명확한 저장 상태와 숨은 인증 필드를 추정 복구하지 않는다", async () => {
    const rows = preflightFixtureRows();
    await rejectRows({ ...rows, courses: [{ ...rows.courses![0], title: 'Bearer test-secret-value' }] }, "invalid-page");
    await rejectRows({ ...rows, advisor_sessions: [{ owner_id: "preflight-owner", id: tutorId(1), version: 1, last_request_id: tutorId(99), state: "{}" }] }, "invalid-state");
    const state = editorReadyFixture();
    await rejectRows({ ...rows, tutor_sessions: [{ owner_id: "preflight-owner", id: state.id, version: state.version, last_request_id: tutorId(99), scope_id: state.start.scopeId, state: JSON.stringify(state) }] }, "missing-reference");
  });
  it("목록 확인 후 바뀐 파일을 스트리밍 전에 거부한다", async () => {
    const root = await directory(); await writeBackupFixture(root, preflightFixtureRows(), [originalEntry]);
    const canonicalRoot: string = await backupRoot(root); const file = await inspectBackupFile(canonicalRoot, originalEntry.path); await writeFile(path.join(root, originalEntry.path), "변경된 원본");
    await expect(hashBackupFile(canonicalRoot, file)).rejects.toMatchObject({ issue: { code: "file-changed" } });
  });
  it("CLI는 임시 색인 폴더 밖 쓰기 권한 없이 전체 검증을 수행한다", async () => {
    const root = await directory(); const scratch = await directory(); await writeBackupFixture(root, preflightFixtureRows(), [originalEntry]);
    const before: string = await readFile(path.join(root, "manifest.json"), "utf8");
    const result = await promisify(execFile)(process.execPath, ["--permission", "--allow-fs-read=*", `--allow-fs-write=${scratch}`, "scripts/backup-preflight.mts", root], { cwd: process.cwd(), env: { ...process.env, TMPDIR: scratch } });
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "passed", targetWrites: 0, providerCalls: 0 });
    expect(await readFile(path.join(root, "manifest.json"), "utf8")).toBe(before);
  });
  it("매니페스트가 없거나 과도한 크기이면 읽기 전에 거부한다", async () => {
    const root = await directory(); await mkdir(path.join(root, "pages"));
    await expect(preflightBackup(root)).rejects.toMatchObject({ issue: { code: "file-unavailable", location: "manifest.json" } });
    await writeFile(path.join(root, "manifest.json"), " ".repeat(8388609));
    await expect(preflightBackup(root)).rejects.toMatchObject({ issue: { code: "file-size" } });
  });
});
