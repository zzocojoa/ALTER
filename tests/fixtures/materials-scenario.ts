import { readFile } from "node:fs/promises";
import { expect, type Page, type Route } from "@playwright/test";
import type { MaterialCard, MaterialLibrary } from "../../lib/materials/library";

export const materialCourseId: string = "00000000-0000-4000-a000-000000000001";
export const emptyMaterialLibrary: MaterialLibrary = { materials: [], courses: [{ id: materialCourseId, title: "학습 과정" }], pending: [], usage: { occupiedBytes: 0, reservedBytes: 0, untrackedBytes: 0, activeTransfers: 0, blocked: false }, hidden: false, hasMore: false, cursor: null };
export function materialFixture(index: number): MaterialCard {
  const id: string = `00000000-0000-4000-a000-${String(index).padStart(12, "0")}`;
  return { id, courseId: materialCourseId, metadata: { title: "한글 자료 · 같은 이름", filename: `파일-${index}.txt`, edition: "2026년", role: "textbook", kind: "text", mime: "text/plain", bytes: 12, sha256: "a".repeat(64) }, file: { materialId: id, kind: "text", role: "textbook", bytes: 12, pages: 1, sha256: "a".repeat(64), objectVersion: "fixture", sourceUrl: `/api/materials/${id}/file` } };
}

export async function materialBrowser(page: Page, initial: MaterialLibrary, api: (route: Route) => Promise<void>): Promise<void> {
  const script: string = await readFile(".sites-runtime/materials-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/materials-browser/fixture.css", "utf8");
  await page.route("https://materials-scenario.local.test/**", async (route): Promise<void> => {
    const path: string = new URL(route.request().url()).pathname;
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (/^\/pdfjs-6\.4\.299\/(?:worker-entry\.mjs|pdf\.worker\.min\.mjs|(?:standard_fonts|cmaps|wasm|iccs)\/[a-zA-Z0-9_.-]+)$/.test(path)) {
      await route.fulfill({ contentType: path.endsWith(".mjs") ? "text/javascript" : "application/octet-stream", body: await readFile(`public${path}`) }); return;
    }
    if (path.startsWith("/api/")) { await api(route); return; }
    expect(path).toBe("/learn/materials");
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="materials-fixture"></div><script id="initial-library" type="application/json">${JSON.stringify(initial).replaceAll("<", "\\u003c")}</script><script src="/fixture.js"></script></html>` });
  });
  await page.goto("https://materials-scenario.local.test/learn/materials");
}
