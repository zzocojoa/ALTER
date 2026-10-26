import { checkAccessibility } from "../fixtures/accessibility";
import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { MaterialCard, MaterialLibrary } from "../../lib/materials/library";
import { readablePdf } from "../fixtures/pdf-bytes";

/** 긴 자료 목록만 주입하고 PDF.js와 원본 페이지 렌더링은 실제로 실행합니다. */
function previewLibrary(pdf: Uint8Array): MaterialLibrary {
  const courseId: string = randomUUID();
  const sha256: string = createHash("sha256").update(pdf).digest("hex");
  const materials: readonly MaterialCard[] = Array.from({ length: 13 }, (_, index): MaterialCard => {
    const id: string = randomUUID();
    return { id, courseId, metadata: { title: `이동 검증 ${index + 1}`, edition: "", role: "textbook", kind: "pdf", filename: "preview.pdf", mime: "application/pdf", bytes: pdf.length, sha256 }, file: { materialId: id, kind: "pdf", role: "textbook", bytes: pdf.length, pages: 3, sha256, objectVersion: "preview-navigation", sourceUrl: `/api/materials/${id}/file` } };
  });
  return { materials, courses: [{ id: courseId, title: "미리보기 이동 검증" }], pending: [], usage: null, hidden: false, hasMore: false, cursor: null };
}

test("긴 목록에서 PDF 클릭·목록 복귀·재선택·다른 자료 선택이 바로 보인다", async ({ page }, info): Promise<void> => {
  const pdf: Uint8Array = readablePdf(3);
  const library: MaterialLibrary = previewLibrary(pdf);
  let blocked: boolean = false;
  await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
  await page.route("**/api/materials", async (route): Promise<void> => { await route.fulfill({ json: library }); });
  await page.route("**/api/materials/*/extraction", async (route): Promise<void> => { await route.fulfill({ json: { job: null, pages: [] } }); });
  await page.route("**/api/materials/*/file", async (route): Promise<void> => { if(blocked) { await route.fulfill({status:403,body:""});return;} await route.fulfill({ status: 200, headers: { "content-type": "application/pdf", "content-length": String(pdf.length), etag: '\"preview-navigation\"' }, body: route.request().method() === "HEAD" ? undefined : Buffer.from(pdf) }); });
  await page.getByRole("button", { name: "목록 새로 확인", exact: true }).click();
  await expect(page.locator(".material-list > li")).toHaveCount(13);
  const first = page.getByRole("button", { name: /^PDF 이동 검증 1 주교재/ });
  await first.click();
  const preview = page.getByRole("region", { name: "선택한 자료", exact: true });
  await expect(preview.getByRole("heading", { name: "이동 검증 1", exact: true })).toBeInViewport();
  await expect(preview).toBeFocused();
  await expect(preview.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
  await expect(preview.locator("canvas")).toBeInViewport();
  await preview.getByRole("button", { name: "자료 목록으로", exact: true }).click();
  await expect(first).toBeFocused();
  await expect(first).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(preview).toBeFocused();
  await expect(preview.getByRole("heading", { name: "이동 검증 1", exact: true })).toBeInViewport();
  await preview.getByRole("button", { name: "자료 목록으로", exact: true }).click();
  await page.getByRole("button", { name: /^PDF 이동 검증 2 주교재/ }).click();
  await expect(preview.getByRole("heading", { name: "이동 검증 2", exact: true })).toBeInViewport();
  await expect(preview.getByText("1페이지를 열었어요.", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(preview.getByText("2페이지를 열었어요.", { exact: true })).toBeVisible();
  const expand = preview.getByRole("button", { name: "파일 2페이지 원본 크게 보기", exact: true });
  await expand.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "파일 2페이지 원본", exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText("파일 2페이지 원본", { exact: true }).last()).toBeVisible();
  await dialog.getByRole("slider", { name: "대조 원본 확대" }).focus(); await page.keyboard.press("ArrowRight"); await expect(dialog.getByRole("slider")).toHaveValue("125");
  await dialog.getByRole("region", { name: "대조 원본 이동 영역" }).focus(); await page.keyboard.press("ArrowDown");
  for(let index=0;index<12;index++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true); }
  await checkAccessibility(page,".original-dialog[open]",info);
  const viewport=page.viewportSize(); await page.setViewportSize({width:800,height:360}); await expect(dialog.getByRole("button",{name:"확대 화면 닫기"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`outputs/original-dialog-${info.project.name}.png`});
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(expand).toBeFocused(); if(viewport) await page.setViewportSize(viewport);
  blocked=true; await expand.click(); await expect(preview.getByRole("alert")).toContainText("HTTP 403"); await expect(dialog).toHaveCount(0); blocked=false;
  await page.screenshot({ path: `outputs/preview-navigation-${info.project.name}.png` });
  expect(await page.pageErrors()).toEqual([]);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate((): void => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(preview).toHaveCount(0);
});
