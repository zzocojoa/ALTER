import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { checkAccessibility } from "../fixtures/accessibility";

const source = { projectId: "원본-사이트", databaseId: "00000000-0000-4000-a000-000000000711", bucketId: "00000000-0000-4000-a000-000000000712", owner: { realm: "sites", userId: "원본-소유자" }, purpose: "primary" };
const target = { projectId: "별도-복원-대상", databaseId: "00000000-0000-4000-a000-000000000713", bucketId: "00000000-0000-4000-a000-000000000714", owner: { realm: "sites", userId: "대상-소유자" }, purpose: "restore-test" };

test("원본 승인 대상·백업 변경은 이전 다운로드를 해제하고 권한 거부 원문을 노출하지 않음", async ({ page }, info) => {
  const now: number = Date.now(); const challenge = { id: "00000000-0000-4000-a000-000000000715", target, issuedAt: now, expiresAt: now + 900000 };
  const backupId: string = "00000000-0000-4000-a000-000000000716"; const requests: string[] = []; let rejected: boolean = false; let accessDenied: boolean = false;
  const script: string = await readFile(".sites-runtime/backup-browser/fixture.iife.js", "utf8"); const css: string = await readFile(".sites-runtime/backup-browser/fixture.css", "utf8");
  await page.route("https://backup.local.test/**", async route => {
    const location: string = new URL(route.request().url()).pathname;
    if (location === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (location === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (location.startsWith("/api/")) {
      requests.push(location); expect(route.request().method()).toBe("POST");
      if (location === "/api/backup/storage") { await route.fulfill({ json: { identity: source } }); return; }
      expect(location).toMatch(/\/restore-approval$/);
      await route.fulfill(rejected ? { status: 403, json: { message: "secret-fixture", error: "signed-fixture-url" } } : { json: { token: "private-fixture-approval-token", backupId, manifestSha256: "a".repeat(64), expiresAt: challenge.expiresAt } }); return;
    }
    if (accessDenied) { await route.fulfill({ status: 403, contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><title>접근 거부</title><h1>소유자만 이용할 수 있어요</h1></html>' }); return; }
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>승인 화면 검사</title><link rel="stylesheet" href="/fixture.css"><div id="backup-fixture"></div><script src="/fixture.js"></script></html>' });
  });
  await page.goto("https://backup.local.test/restore-source"); expect(requests).toHaveLength(0); await expect(page.getByRole("button", { name: "이 대상에 완료 백업 복원 승인" })).toBeDisabled();
  await page.getByRole("button", { name: "원본 저장소 확인" }).click(); await expect(page.getByText("원본-사이트", { exact: true })).toBeVisible();
  await page.getByLabel("완료 백업 ID").fill(backupId); await page.getByLabel("대상에서 받은 복원 요청 파일").setInputFiles({ name: "request.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(challenge)) });
  await expect(page.getByText("별도-복원-대상", { exact: true })).toBeVisible(); expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "이 대상에 완료 백업 복원 승인" }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByRole("link", { name: "복원 승인 파일 다운로드" })).toBeVisible(); expect(requests).toHaveLength(2); await expect(page.locator("body")).not.toContainText("private-fixture-approval-token");
  await page.getByLabel("완료 백업 ID").fill("00000000-0000-4000-a000-000000000717"); await expect(page.getByRole("link", { name: "복원 승인 파일 다운로드" })).toHaveCount(0);
  expect(await page.getByRole("button", { name: "이 대상에 완료 백업 복원 승인" }).evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  rejected = true; await page.getByRole("button", { name: "이 대상에 완료 백업 복원 승인" }).click(); await expect(page.getByRole("alert")).toContainText("HTTP 403"); await expect(page.locator("body")).not.toContainText("secret-fixture");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await checkAccessibility(page, "main", info); await page.screenshot({ path: info.outputPath("복원-승인.png"), fullPage: true });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide"))); await expect(page.getByText("원본-사이트", { exact: true })).toBeHidden();
  accessDenied = true; await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(page.getByRole("heading", { name: "소유자만 이용할 수 있어요" })).toBeVisible(); await expect(page.locator("body")).not.toContainText("원본-사이트"); expect(requests).toHaveLength(3);
});
