import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { checkAccessibility } from "../fixtures/accessibility";

test("더보기는 관리 그룹 6개와 기존 목적지를 구분하고 진입으로 작업하지 않음", async ({ page }, info): Promise<void> => {
  const script = await readFile(".sites-runtime/dashboard-browser/fixture.iife.js", "utf8"); const css = await readFile(".sites-runtime/dashboard-browser/fixture.css", "utf8");
  await page.route("https://settings.local.test/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (path.startsWith("/api/")) throw new Error(`메뉴 탐색에서 발생한 작업 요청: ${path}`);
    expect(path).toBe("/learn/more"); await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>설정 검사</title><link rel="stylesheet" href="/fixture.css"><div id="dashboard-fixture"></div><script src="/fixture.js"></script></html>' });
  });
  await page.goto("https://settings.local.test/learn/more");
  const menu = page.getByRole("navigation", { name: "관리 메뉴", exact: true });
  for (const name of ["계정", "Google 연결", "비용과 사용량", "자료와 저장공간", "백업과 복원", "소유자 진단"]) await expect(menu.getByRole("heading", { name, exact: true })).toBeVisible();
  const links: readonly Readonly<{ label: string; href: string }>[] = [
    { label: "인증 상태 확인", href: "/api/session" }, { label: "로그아웃", href: "/signout-with-chatgpt?return_to=%2F" }, { label: "Google 연결 관리", href: "/learn/google" }, { label: "선택한 Google 참고 자료", href: "/learn/google/references" }, { label: "학습·복습 일정 관리", href: "/learn/calendar" }, { label: "사용량과 비용 확인", href: "/learn#check-budget" }, { label: "자료 보관함과 저장 공간 확인", href: "/learn/materials" }, { label: "백업과 복원", href: "/learn/backup" }, { label: "별도 저장소 복원 관리", href: "/restore" }, { label: "소유자 진단 열기", href: "/learn/diagnostics" },
  ];
  for (const link of links) { const locator = menu.getByRole("link", { name: link.label, exact: true }); await expect(locator).toHaveAttribute("href", link.href); const box = await locator.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(48); }
  await expect(menu.getByRole("link", { name: "로그아웃", exact: true })).toHaveAttribute("target", "_top");
  await menu.getByRole("link", { name: "인증 상태 확인" }).focus(); await page.keyboard.press("Tab"); await expect(menu.getByRole("link", { name: "로그아웃" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await checkAccessibility(page, ".settings-menu", info);
  await page.screenshot({ path: info.outputPath("설정-그룹.png"), fullPage: true }); await page.reload(); await expect(menu).toBeVisible(); expect(await page.pageErrors()).toEqual([]);
});
