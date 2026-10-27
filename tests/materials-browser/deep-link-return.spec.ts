import { expect, test } from "@playwright/test";
import { emptyMaterialLibrary, materialBrowser, materialFixture } from "../fixtures/materials-scenario";
import type { MaterialCard } from "../../lib/materials/library";

test("직접 링크와 새로고침으로 연 자료는 회전 후에도 해당 목록 행으로 복귀한다", async ({ page }, info): Promise<void> => {
  const materials: readonly MaterialCard[] = Array.from({ length: 13 }, (_, index): MaterialCard => materialFixture(1800 + index));
  const selected: MaterialCard = materials[12];
  await materialBrowser(page, { ...emptyMaterialLibrary, materials }, async (route): Promise<void> => {
    const request = route.request(); const path: string = new URL(request.url()).pathname;
    expect(request.method()).toBe("GET");
    if (path.endsWith("/extraction")) { await route.fulfill({ json: { job: null, pages: [] } }); return; }
    expect(path).toBe(selected.file.sourceUrl); await route.fulfill({ contentType: "text/plain", body: "직접 링크의 합성 원본" });
  });
  for (const viewport of [{ width: 568, height: 320 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`https://materials-scenario.local.test/learn/materials?open=${selected.id}`);
    await page.reload();
    await expect(page.getByRole("region", { name: "선택한 자료", exact: true })).toBeFocused();
    await expect(page.getByRole("region", { name: "선택한 자료", exact: true }).getByLabel("텍스트 원본", { exact: true })).toContainText("직접 링크의 합성 원본");
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.getByRole("button", { name: "자료 목록으로", exact: true }).click();
    const row = page.locator(`#material-${selected.id}`);
    await expect(row).toBeFocused(); await expect(row).toBeInViewport();
    await expect(page).not.toHaveURL(/open=/);
    expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`복귀-${viewport.width}.png`) });
  }
  expect(await page.pageErrors()).toEqual([]);
});
