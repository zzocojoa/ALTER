import { expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { checkAccessibility } from "./accessibility";

/** 화면 상태별 자동 viewport 근거이며 실제 화면 키보드·safe-area 검증은 별도입니다. */
export async function checkMaterialViewports(page: Page, info: TestInfo, state: string): Promise<void> {
  const initial = page.viewportSize();
  if (initial === null) throw new Error("검사할 초기 viewport가 없습니다.");
  const viewports: readonly (readonly [number, number])[] = [[320, 720], [390, 844], [402, 874], [768, 1024], [1024, 768], [1440, 900]];
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await checkAccessibility(page, ".extraction-panel", info);
  }
  await info.attach(`PDF 화면 상태 ${state}`, { contentType: "application/json", body: JSON.stringify({ state, viewports, overflow: false, axeViolations: 0, physicalDevice: false }) });
  await page.setViewportSize(initial);
}
