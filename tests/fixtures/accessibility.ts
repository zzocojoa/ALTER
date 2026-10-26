import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

/** 실제 표시된 영역의 자동 검사 결과를 보관하며 수동 보조 기술 검사를 대체하지 않습니다. */
export async function checkAccessibility(page: Page, selector: string, info: TestInfo): Promise<void> {
  const result = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await info.attach("접근성-자동검사", { contentType: "application/json", body: JSON.stringify(result) });
  expect(result.violations).toEqual([]);
}
