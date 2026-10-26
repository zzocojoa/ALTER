import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createBackupArchive } from "../../lib/backup/archive";
import type { BackupArchiveFile } from "../../lib/backup/archive";
import { restorePageOrder } from "../../lib/backup/restore-order";
import { backupFixtureId } from "../fixtures/backup-files";
import { backupExportFixture } from "../fixtures/backup-export-api";
import { checkAccessibility } from "../fixtures/accessibility";
test("격리 복원 화면의 전송 실패·같은 ID 재개·검증 후 별도 활성화", async ({ page }, info) => {
  const root = await mkdtemp(path.join(tmpdir(), "alter-restore-browser-"));
  try {
    const fixture = await backupExportFixture(root); const manifest = fixture.manifest; const files: BackupArchiveFile[] = [];
    for (const name of ["manifest.json", ...manifest.pages.map(entry => entry.path), ...manifest.objects.map(entry => entry.path)]) files.push({ path: name, file: new Blob([await readFile(path.join(root, name))]) });
    const archivePath = path.join(root, "backup.tar"); await writeFile(archivePath, Buffer.from(await createBackupArchive(files).arrayBuffer()));
    const now: number = Date.now(); const source = { projectId: manifest.basis.sourceProjectId, owner: { realm: "sites", userId: manifest.basis.ownerId }, databaseId: backupFixtureId(200), bucketId: backupFixtureId(201), purpose: "primary" };
    const target = { projectId: "isolated-local-test", owner: { realm: "sites", userId: "target-owner" }, databaseId: backupFixtureId(202), bucketId: backupFixtureId(203), purpose: "restore-test" };
    const challenge = { id: backupFixtureId(204), target, issuedAt: now, expiresAt: now + 900000 };
    const hash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex"); const approval = { token: "local-fixture-not-a-credential", backupId: manifest.backupId, manifestSha256: hash, expiresAt: now + 900000 };
    const authorization = { version: 1, purpose: "isolated-backup-restore", challenge, source, backupId: manifest.backupId, manifestSha256: hash, issuedAt: now, expiresAt: now + 900000, restoredExecutionAuthority: "none", googleConsent: "required" };
    const approvalPath = path.join(root, "approval.json"); await writeFile(approvalPath, JSON.stringify({ approval, challenge }));
    let runId: string | null = null; let state: string = "receiving"; let fail: boolean = true; const requests: string[] = [];
    const script = await readFile(".sites-runtime/backup-browser/fixture.iife.js", "utf8"); const css = await readFile(".sites-runtime/backup-browser/fixture.css", "utf8");
    await page.route("https://backup.local.test/**", async route => {
      const request = route.request(); const url = new URL(request.url()); const location: string = url.pathname;
      if (location === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
      if (location === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
      if (!location.startsWith("/api/")) { await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>복원 검증</title><link rel="stylesheet" href="/fixture.css"><div id="backup-fixture"></div><script src="/fixture.js"></script></html>' }); return; }
      requests.push(`${request.method()} ${location}`);
      if (location === "/api/restore/storage") { await route.fulfill({ json: { identity: target } }); return; }
      if (location === "/api/restore/challenges") { await route.fulfill({ json: challenge }); return; }
      if (location === "/api/restore/runs" && request.method() === "POST") { runId = (request.postDataJSON() as { id: string }).id; await route.fulfill({ json: { id: runId, state, authorization } }); return; }
      if (/^\/api\/restore\/runs\/[^/]+$/.test(location) && request.method() === "GET") { await route.fulfill(runId === null ? { status: 409, json: { error: "wrong-backup", field: "run-missing" } } : { json: { id: runId, state, authorization } }); return; }
      if (location.endsWith("/pages/courses/0") && request.method() === "PUT" && fail) { fail = false; await route.fulfill({ status: 503, json: { error: "storage_failure", location: "fixture-receive" } }); return; }
      if (request.method() === "PUT" && !location.endsWith("/manifest")) {
        const entry = location.includes("/objects/") ? manifest.objects[Number(location.split("/").at(-1))] : manifest.pages.find(entry => location.endsWith(`/pages/${entry.table}/${entry.ordinal}`));
        expect(entry).toBeDefined(); expect(createHash("sha256").update(request.postDataBuffer()!).digest("hex")).toBe(entry!.sha256);
      }
      if (location.endsWith("/import")) state = "verifying";
      if (location.endsWith("/verify/complete")) state = "verified";
      if (location.endsWith("/activate")) { expect(state).toBe("verified"); state = "activated"; }
      await route.fulfill({ json: { state, row_count: manifest.counts.reduce((sum, entry) => sum + entry.rows, 0), page_count: manifest.pages.length, object_count: manifest.objects.length } });
    });
    await page.goto("https://backup.local.test/restore-target"); await page.getByLabel("완료 백업 TAR").setInputFiles(archivePath); await page.getByLabel("원본에서 받은 복원 승인 JSON").setInputFiles(approvalPath);
    await page.getByRole("button", { name: "파일 검사 후 복원 실행" }).click(); await expect(page.getByRole("alert")).toContainText("storage_failure"); expect(requests.some(value => value.endsWith("/import"))).toBe(false); expect(requests.some(value => value.endsWith("/activate"))).toBe(false);
    await page.getByRole("button", { name: "같은 복원 이어가기" }).click(); await expect(page.getByRole("status")).toContainText("기록·출처·원본 대조가 통과", { timeout: 45000 });
    expect(requests.filter(value => value === "POST /api/restore/runs")).toHaveLength(1); expect(requests.filter(value => value.includes("/import/pages/")).map(value => value.split("/import/pages/")[1])).toEqual(restorePageOrder(manifest).map(entry => `${entry.table}/${entry.ordinal}`)); expect(requests.some(value => value.endsWith("/activate"))).toBe(false);
    await page.getByRole("button", { name: "검증된 학습 기록 활성화" }).click(); await expect(page.getByRole("status")).toContainText("AI 예산과 외부 연동 실행 권한은 미확인");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await checkAccessibility(page, "main", info); expect(await page.pageErrors()).toEqual([]);
  } finally { await rm(root, { recursive: true }); }
});
