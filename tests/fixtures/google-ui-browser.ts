import { readFile } from "node:fs/promises";
import { type Page } from "@playwright/test";
import type { GoogleConnectionView } from "../../lib/google/view";

export async function mountGoogleConnection(page: Page, state: NonNullable<GoogleConnectionView["connection"]>["state"] | "none", configured: boolean, outcome: string | null): Promise<void> {
  const script = await readFile(".sites-runtime/google-report-browser/fixture.iife.js", "utf8");
  const css = await readFile(".sites-runtime/google-report-browser/fixture.css", "utf8");
  await page.route("https://google.connection.test/**", async (route): Promise<void> => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (path.startsWith("/api/")) throw new Error(`사용자 실행 없이 발생한 요청: ${path}`);
    await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google 연결 검사</title><link rel="stylesheet" href="/fixture.css"><main id="google-fixture"></main><script src="/fixture.js"></script></html>' });
  });
  const params = new URLSearchParams({ panel: "connection", connection: state, configured: configured ? "1" : "0" });
  if (outcome !== null) params.set("outcome", outcome);
  await page.goto(`https://google.connection.test/learn/google?${params}`);
}
