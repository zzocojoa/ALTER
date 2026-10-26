import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { createBackupArchive, backupTarHeader } from "../../lib/backup/archive";
import { readBrowserBackupArchive } from "../../lib/backup/browser-archive";
import { exportBrowserBackup } from "../../lib/backup/browser-export";
import { verifyBackupBlob } from "../../lib/backup/browser-files";
import type { BackupBrowserStorage } from "../../lib/backup/browser-files";
import { preflightBackup } from "../../scripts/backup/preflight";
import { backupExportFixture } from "../fixtures/backup-export-api";
const directories: string[] = [];
async function directory(): Promise<string> { const root = await mkdtemp(path.join(tmpdir(), "alter-browser-export-")); directories.push(root); return root; }
afterEach(async () => { for (const root of directories.splice(0)) await rm(root, { recursive: true }); });
function memoryStorage(): BackupBrowserStorage {
  const files = new Map<string, File>();
  return {
    write: async (name, stream, expected, signal) => { const file = new File([await new Response(stream).blob()], name); await verifyBackupBlob(file, expected, signal); files.set(name, file); return file; },
    read: async (name, expected, signal) => { const file = files.get(name); if (!file) throw new Error("저장한 백업 파일이 없습니다."); await verifyBackupBlob(file, expected, signal); return file; },
    saveManifest: async text => new File([text], "manifest.json"),
  };
}
describe("브라우저 백업 내보내기", () => {
  test("전체 수신 후 표준 tar로 풀고 독립 사전 검증기를 통과한다; 완료 백업은 GET만 사용한다", async () => {
    const root = await directory(); const fixture = await backupExportFixture(root); fixture.state.exists = false; const storage = memoryStorage();
    const runtime = { fetch: (async (input, init) => fixture.respond(String(input), init?.method ?? "GET")) as typeof fetch, storage, signal: new AbortController().signal, progress: (): void => {} };
    const result = await exportBrowserBackup(fixture.manifest.backupId, runtime);
    const decoded = await readBrowserBackupArchive(result.archive, new AbortController().signal, (): void => {}); expect(decoded.manifest).toEqual(result.manifest); expect(decoded.originals).toEqual([{ ordinal: 0, uploadPage: 0, transferPage: 0 }]);
    const corrupted = new Blob([new Uint8Array([255]), result.archive.slice(1)]); await expect(readBrowserBackupArchive(corrupted, new AbortController().signal, (): void => {})).rejects.toThrow(/헤더/);
    await expect(readBrowserBackupArchive(result.archive.slice(0, result.archive.size - 1024), new AbortController().signal, (): void => {})).rejects.toThrow(/종료 블록/);
    const target = await directory(); const archive = path.join(target, "backup.tar"); const extracted = path.join(target, "extracted"); await mkdir(extracted);
    await writeFile(archive, Buffer.from(await result.archive.arrayBuffer())); await promisify(execFile)("tar", ["-xf", archive, "-C", extracted]);
    const verified = await preflightBackup(extracted); expect(verified.status).toBe("passed"); expect(verified.objects).toBe(1);
    const before: number = fixture.requests.length; const resumed = await exportBrowserBackup(fixture.manifest.backupId, runtime);
    expect(resumed.archive.size).toBe(result.archive.size); expect(fixture.requests.slice(before).every(item => item.startsWith("GET "))).toBe(true);
    expect(fixture.requests.filter(item => item === "POST /api/backup")).toHaveLength(1);
    expect(await readFile(path.join(extracted, "objects/000000.bin"))).toEqual(await readFile(path.join(root, "objects/000000.bin")));
  });
  test.each(["pages/courses/000000.json", "objects/000000.bin"])("%s 손상 시 수신 완료와 전체 완료를 보내지 않는다", async damagedPath => {
    const fixture = await backupExportFixture(await directory()); fixture.state.damagedPath = damagedPath;
    await expect(exportBrowserBackup(fixture.manifest.backupId, { fetch: (async (input, init) => fixture.respond(String(input), init?.method ?? "GET")) as typeof fetch, storage: memoryStorage(), signal: new AbortController().signal, progress: (): void => {} })).rejects.toThrow(/SHA-256/);
    expect(fixture.requests.some(item => item.endsWith("/complete"))).toBe(false);
    const endpoint = damagedPath.startsWith("objects") ? "/objects/0/received" : "/pages/courses/0/received";
    expect(fixture.requests.some(item => item.endsWith(endpoint))).toBe(false);
  });
  test("취소 신호와 64KiB 경계를 검사하고 잘못된 경로·중복 TAR 항목을 거부한다", async () => {
    const data = new Uint8Array(130_001).fill(37); const proof = { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
    await verifyBackupBlob(new Blob([data]), proof, new AbortController().signal);
    const controller = new AbortController(); controller.abort(); await expect(verifyBackupBlob(new Blob([data]), proof, controller.signal)).rejects.toThrow();
    expect(() => backupTarHeader("../secret", 1)).toThrow(); expect(() => createBackupArchive([{ path: "manifest.json", file: new Blob() }, { path: "manifest.json", file: new Blob() }])).toThrow();
  });
});
