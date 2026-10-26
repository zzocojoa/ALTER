import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { backupExportFixture } from "../fixtures/backup-export-api";
import { checkAccessibility } from "../fixtures/accessibility";
test("OPFS 손상 중단·이어받기·TAR 다운로드·새로고침 및 작은 화면", async ({ page }, info) => {
  const root = await mkdtemp(path.join(tmpdir(), "alter-backup-browser-"));
  try {
    const fixture = await backupExportFixture(root); fixture.state.damagedPath = fixture.manifest.pages[0]!.path;
    const script = await readFile(".sites-runtime/backup-browser/fixture.iife.js", "utf8"); const css = await readFile(".sites-runtime/backup-browser/fixture.css", "utf8");
    await page.addInitScript(id => localStorage.setItem("alter-backup-test", id), fixture.manifest.backupId);
    await page.route("https://backup.local.test/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
      if (url.pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
      if (url.pathname.startsWith("/api/")) { const response = await fixture.respond(url.href, route.request().method()); await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) }); return; }
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>백업 검증</title><link rel="stylesheet" href="/fixture.css"><div id="backup-fixture"></div><script src="/fixture.js"></script></html>' });
    });
    await page.goto("https://backup.local.test/learn/backup"); await page.getByRole("button", { name: "같은 백업 이어받기" }).click();
    await expect(page.getByRole("alert")).toContainText("체크섬"); await expect(page.getByRole("link", { name: "검증한 백업 파일 다운로드" })).toHaveCount(0); expect(fixture.requests.some(item => item.endsWith("/received"))).toBe(false);
    fixture.state.damagedPath = null; await page.getByRole("button", { name: "같은 백업 이어받기" }).click();
    await expect(page.getByRole("status")).toContainText("백업 수신·검증 완료", { timeout: 45000 });
    const downloadEvent = page.waitForEvent("download"); await page.getByRole("link", { name: "검증한 백업 파일 다운로드" }).click(); const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe(`ALTER-backup-${fixture.manifest.backupId}.tar`); expect(await download.failure()).toBeNull();
    const before: number = fixture.requests.length; await page.reload(); await page.getByRole("button", { name: "같은 백업 이어받기" }).click();
    await expect(page.getByRole("status")).toContainText("백업 수신·검증 완료"); expect(fixture.requests.slice(before).every(item => item.startsWith("GET "))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await checkAccessibility(page, "main", info); expect(await page.pageErrors()).toEqual([]);
  } finally { await rm(root, { recursive: true }); }
});
