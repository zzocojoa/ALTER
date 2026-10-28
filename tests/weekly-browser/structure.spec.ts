import { expect, test } from "@playwright/test";
import { weeklyViewFixture, mountWeeklyView } from "../fixtures/weekly-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";

test("주간 초안 네 단계 탐색은 실제 편집 영역으로 이동하고 입력·근거 연결을 유지", async ({ page }, info): Promise<void> => {
  await mountWeeklyView(page, await weeklyViewFixture());
  const navigation = page.getByRole("navigation", { name: "주간 초안 검토 순서" });
  const steps = [{ label: "1 성과", target: "weekly-achievements" }, { label: "2 어려움·미확인", target: "weekly-difficulties" }, { label: "3 개선 메모", target: "weekly-improvements" }, { label: "4 다음 주 계획", target: "weekly-next-plan" }];
  for (const step of steps) {
    await navigation.getByRole("link", { name: step.label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${step.target}$`));
    await expect(page.locator(`#${step.target}`)).toBeInViewport();
  }
  await page.getByRole("textbox", { name: /내 메모/ }).fill("나눗셈의 뜻을 설명하기 어려워 다음에는 예시부터 설명할 계획입니다.");
  await navigation.getByRole("link", { name: "1 성과", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /내 메모/ })).toHaveValue("나눗셈의 뜻을 설명하기 어려워 다음에는 예시부터 설명할 계획입니다.");
  await page.getByRole("link", { name: "근거 답안 보기", exact: true }).first().click();
  await expect(page.locator("article[id^=weekly-answer-]").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, ".weekly-workspace", info);
  expect(await page.pageErrors()).toEqual([]);
});
