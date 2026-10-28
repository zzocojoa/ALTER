import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { backupExportFixture } from "../fixtures/backup-export-api";
import { checkAccessibility } from "../fixtures/accessibility";

async function mountBackup(page: Page, respond: (route: Route) => Promise<void>, id: string): Promise<void> {
  const script: string = await readFile(".sites-runtime/backup-browser/fixture.iife.js", "utf8"); const css: string = await readFile(".sites-runtime/backup-browser/fixture.css", "utf8");
  await page.addInitScript(value => localStorage.setItem("alter-backup-test", value), id);
  await page.route("https://backup.local.test/**", async route => {
    const location: string = new URL(route.request().url()).pathname;
    if (location === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (location === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (location.startsWith("/api/")) { await respond(route); return; }
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>백업 상태 검사</title><link rel="stylesheet" href="/fixture.css"><div id="backup-fixture"></div><script src="/fixture.js"></script></html>' });
  });
  await page.goto("https://backup.local.test/learn/backup");
}

for (const status of [401, 403]) test(`접근 거부 ${status}는 서버 원문 없이 안내하고 수신 완료로 처리하지 않음`, async ({ page }, info) => {
  const requests: string[] = [];
  await mountBackup(page, async route => { requests.push(route.request().method()); await route.fulfill({ status, json: { error: "sensitive-server-error", message: "secret-fixture https://signed.example.test/?token=secret-fixture" } }); }, "00000000-0000-4000-a000-000000000701");
  expect(requests).toHaveLength(0); await page.getByRole("button", { name: "같은 백업 이어받기" }).click();
  await expect(page.getByRole("alert")).toContainText(`HTTP ${status}`); await expect(page.locator("body")).not.toContainText("secret-fixture");
  await expect(page.locator('[data-backup-step="verify"]')).toContainText("완료 확인 안 됨"); await expect(page.getByRole("link", { name: "검증한 백업 파일 다운로드" })).toHaveCount(0);
  expect(requests).toEqual(["GET"]); await expect(page.getByRole("link", { name: "소유자 접근 상태 확인" })).toHaveAttribute("href", "/learn"); await checkAccessibility(page, "main", info);
});

test("서버 완료 이력만 있고 브라우저 파일이 없으면 다운로드를 성공으로 표시하지 않음", async ({ page }) => {
  const root: string = await mkdtemp(path.join(tmpdir(), "alter-backup-missing-"));
  try {
    const fixture = await backupExportFixture(root); fixture.state.completed = true;
    await mountBackup(page, async route => { const response: Response = await fixture.respond(route.request().url(), route.request().method()); await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) }); }, fixture.manifest.backupId);
    await page.getByRole("button", { name: "같은 백업 이어받기" }).click(); await expect(page.getByRole("alert")).toContainText("브라우저에 받은 파일이 없어요");
    await expect(page.getByRole("link", { name: "검증한 백업 파일 다운로드" })).toHaveCount(0); expect(fixture.requests.every(value => value.startsWith("GET "))).toBe(true);
  } finally { await rm(root, { recursive: true }); }
});

test("연속 시작은 한 요청만 보내고 중단 뒤 같은 ID와 실패 상태를 유지함", async ({ page }, info) => {
  const requests: string[] = []; let release: (() => void) | null = null;
  const gate: Promise<void> = new Promise(resolve => { release = resolve; });
  await mountBackup(page, async route => { requests.push(route.request().method()); await gate; await route.fulfill({ status: 503, json: { error: "stopped" } }); }, "00000000-0000-4000-a000-000000000702");
  await page.getByRole("button", { name: "같은 백업 이어받기" }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => requests.length).toBe(1); await page.getByRole("button", { name: "수신 중단" }).click();
  await expect(page.getByRole("alert")).toContainText("수신을 중단했어요"); (release as (() => void) | null)?.();
  await expect(page.getByLabel("백업 ID")).toHaveValue("00000000-0000-4000-a000-000000000702"); await expect(page.getByRole("button", { name: "같은 백업 이어받기" })).toBeEnabled();
  await expect(page.locator('[data-backup-step="download"]')).toContainText("검증 후 가능");
  expect(await page.locator('[data-backup-step="download"] .alter-badge').evaluate(element => getComputedStyle(element).display)).toBe("inline-flex");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await checkAccessibility(page, "main", info); await page.screenshot({ path: info.outputPath("백업-중단.png"), fullPage: true });
});
