import { readFile } from "node:fs/promises";
import { expect, type Page, type Route } from "@playwright/test";

export async function mountUsage(page: Page, read: (route: Route) => Promise<void>, fragment: string): Promise<void> {
  const script = await readFile(".sites-runtime/dashboard-browser/fixture.iife.js", "utf8"); const css = await readFile(".sites-runtime/dashboard-browser/fixture.css", "utf8");
  await page.route("https://usage.ui.test/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (path === "/api/dashboard/usage") { expect(route.request().method()).toBe("GET"); await read(route); return; }
    expect(path).toBe("/usage"); await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>사용량 검사</title><link rel="stylesheet" href="/fixture.css"><div id="dashboard-fixture"></div><script src="/fixture.js"></script></html>' });
  });
  await page.goto(`https://usage.ui.test/usage${fragment}`);
}
