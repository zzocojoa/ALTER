import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { MaterialCard, MaterialLibrary } from "../../lib/materials/library";
import { checkAccessibility } from "../fixtures/accessibility";

const courseId: string = "00000000-0000-4000-a000-000000000001";
export function material(index: number): MaterialCard {
  const id: string = `00000000-0000-4000-a000-${String(index).padStart(12, "0")}`;
  return { id, courseId, metadata: { title: "한글 자료 · 같은 이름", filename: `파일-${index}.txt`, edition: "2026년", role: "textbook", kind: "text", mime: "text/plain", bytes: 12, sha256: "a".repeat(64) }, file: { materialId: id, kind: "text", role: "textbook", bytes: 12, pages: 1, sha256: "a".repeat(64), objectVersion: "fixture", sourceUrl: `/api/materials/${id}/file` } };
}

test("자료 행은 원본 등록과 선택을 구분하고 숨김 중 원본을 열지 않는다", async ({ page }, info) => {
  const script: string = await readFile(".sites-runtime/materials-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/materials-browser/fixture.css", "utf8");
  const library: MaterialLibrary = { materials: [material(2), material(3)], courses: [{ id: courseId, title: "학습 과정" }], pending: [], usage: { occupiedBytes: 24, reservedBytes: 0, untrackedBytes: 0, activeTransfers: 0, blocked: false }, hidden: false, hasMore: false, cursor: null };
  let hidden: boolean = false;
  const requests: string[] = [];
  await page.route("https://materials.local.test/**", async (route): Promise<void> => {
    const path: string = new URL(route.request().url()).pathname;
    requests.push(route.request().method() + " " + path);
    expect(route.request().method()).toBe("GET");
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (path === "/api/materials") { await route.fulfill({ json: { ...library, hidden } }); return; }
    if (path.endsWith("/extraction")) { await route.fulfill({ json: { job: null, pages: [] } }); return; }
    if (path.endsWith("/file")) { await route.fulfill({ contentType: "text/plain", body: "검증용 원본" }); return; }
    expect(path).toBe("/learn/materials");
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="materials-fixture"></div><script id="initial-library" type="application/json">${JSON.stringify(library)}</script><script src="/fixture.js"></script></html>` });
  });
  await page.goto("https://materials.local.test/learn/materials");
  const rows = page.locator(".alter-material-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("파일-2.txt");
  await expect(rows.last()).toContainText("파일-3.txt");
  await expect(rows.first()).toContainText("원본 등록 확인됨");
  await expect(rows.first()).toContainText("1페이지");
  await rows.last().click();
  await expect(page.getByRole("region", { name: "선택한 자료", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "선택한 자료", exact: true })).toContainText("검증용 원본");
  await page.getByRole("button", { name: "자료 목록으로", exact: true }).click();
  await expect(rows.last()).toBeFocused();
  await expect(rows.last()).toHaveAttribute("aria-pressed", "false");
  await expect(page).not.toHaveURL(/open=/);
  await rows.last().click();
  await expect(page).toHaveURL(/open=00000000-0000-4000-a000-000000000003/);
  await page.goBack();
  await expect(rows.last()).toBeFocused();
  await expect(page.getByRole("region", { name: "선택한 자료", exact: true })).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole("region", { name: "선택한 자료", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "자료 목록으로", exact: true }).click();
  hidden = true;
  await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click();
  await expect(page.getByRole("region", { name: "선택한 자료", exact: true })).toHaveCount(0);
  await expect(rows.first()).toBeDisabled();
  await page.getByText("새 자료 등록", { exact: true }).click();
  await expect(page.getByLabel("원본 파일", { exact: true })).toHaveAttribute("accept", ".pdf,.png,.jpg,.jpeg,.txt");
  await expect(page.getByRole("list", { name: "파일별 등록 제한" })).toContainText("20 MiB · 500페이지");
  await page.getByLabel("자료 제목", { exact: true }).fill("한글 입력 유지");
  await page.getByRole("combobox", { name: "입력 방식", exact: true }).selectOption("text");
  await page.getByLabel("텍스트 원본", { exact: true }).fill("원본 문장");
  await page.getByRole("combobox", { name: "입력 방식", exact: true }).selectOption("file");
  await page.getByRole("combobox", { name: "입력 방식", exact: true }).selectOption("text");
  await expect(page.getByLabel("텍스트 원본", { exact: true })).toHaveValue("원본 문장");
  await page.getByText("새 자료 등록", { exact: true }).click();
  await page.getByText("새 자료 등록", { exact: true }).click();
  await expect(page.getByLabel("자료 제목", { exact: true })).toHaveValue("한글 입력 유지");
  await checkAccessibility(page, ".material-library", info);
  expect(requests.every((value): boolean => value.startsWith("GET "))).toBe(true);
  expect(await page.pageErrors()).toEqual([]);
});
