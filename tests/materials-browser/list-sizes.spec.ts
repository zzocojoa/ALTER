import { expect, test } from "@playwright/test";
import type { MaterialCard, MaterialLibrary } from "../../lib/materials/library";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import { checkAccessibility } from "../fixtures/accessibility";

for (const count of [0, 1, 100]) {
  test(`${count}개 자료는 서버 커서로 이어 읽고 긴 한글·동명 자료를 구분한다`, async ({ page }, info) => {
    const cards: readonly MaterialCard[] = Array.from({ length: count }, (_, index): MaterialCard => {
      const card = materialFixture(index + 100);
      return { ...card, metadata: { ...card.metadata, title: "한글 제목".repeat(40), filename: `같은이름-${index}-` + "자료".repeat(40) + ".txt" } };
    });
    const initial: MaterialLibrary = { ...emptyMaterialLibrary, materials: cards.slice(0, 50), hasMore: count > 50, cursor: cards.slice(0, 50).at(-1)?.id ?? null };
    const requests: string[] = [];
    await materialBrowser(page, initial, async (route): Promise<void> => {
      const url: URL = new URL(route.request().url());
      expect(route.request().method()).toBe("GET"); requests.push(url.pathname + url.search);
      if (url.pathname.endsWith("/extraction")) { await route.fulfill({ json: { job: null, pages: [] } }); return; }
      if (url.pathname.endsWith("/file")) { await route.fulfill({ contentType: "text/plain", body: "등록된 텍스트 원본" }); return; }
      expect(url.pathname).toBe("/api/materials"); expect(url.searchParams.get("after")).toBe(cards[49].id);
      await route.fulfill({ json: { ...initial, materials: cards.slice(50), hasMore: false, cursor: cards.at(-1)?.id ?? null } });
    });
    await expect(page.locator(".alter-material-row")).toHaveCount(Math.min(count, 50));
    if (count === 0) {
      await expect(page.getByText("배울 내용을 한곳에", { exact: true })).toBeVisible();
      await expect(page.getByLabel("자료 제목", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("region", { name: "자료 등록 단계", exact: true })).toHaveCount(0);
      await expect(page.getByText("배울 내용을 한곳에", { exact: true })).toHaveCount(0);
      if (count === 100) {
        await expect(page.getByRole("heading", { name: "나의 자료 현재 50개 · 더 있음", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "자료 더 보기", exact: true }).click();
        await expect(page.locator(".alter-material-row")).toHaveCount(100);
        await expect(page.getByRole("button", { name: "자료 더 보기", exact: true })).toHaveCount(0);
        expect(requests).toEqual([`/api/materials?after=${cards[49].id}`]);
      }
      await expect(page.locator(".alter-material-row").last()).toContainText(cards.at(-1)?.metadata.filename ?? "");
      await page.locator(".alter-material-row").last().click();
      await expect(page.getByRole("region", { name: "선택한 자료", exact: true })).toBeFocused();
      await page.goBack();
      await expect(page.locator(".alter-material-row").last()).toBeFocused();
      await expect(page.locator(".alter-material-row").last()).toBeInViewport();
    }
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 320, height: 600 });
    await page.evaluate((): void => { document.documentElement.style.fontSize = "200%"; });
    expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await checkAccessibility(page, ".material-library", info);
    await page.evaluate((): void => { document.documentElement.style.removeProperty("font-size"); window.scrollTo(0, 0); });
    if (count === 1) await page.screenshot({ path: `outputs/ui-materials/list-${info.project.name}.png`, fullPage: true });
    expect(await page.pageErrors()).toEqual([]);
  });
}
