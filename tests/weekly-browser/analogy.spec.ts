import { expect, test } from "@playwright/test";
import { weeklyViewFixture, mountWeeklyView } from "../fixtures/weekly-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";

test("긴 한국어 비유의 공통점·차이점·한계를 별도 카드에서 편집하고 가림 복귀 보존", async ({ page }, info): Promise<void> => {
  const data = await weeklyViewFixture(); const proposal = data.state.proposal; if (!proposal) throw new Error("비유 시험 초안 누락");
  const long = "분수와음악은전체를일정한단위로나누어일부를표현하지만실제음악의강세와연주해석은다릅니다".repeat(15);
  const analogy = { ...proposal.roommate.analogy, example: long, similarities: [long, "부분을 선택하는 구조"], differences: [long], limitations: [long, "모든 상황에 적용하지 않음"] };
  await mountWeeklyView(page, { ...data, state: { ...data.state, proposal: { ...proposal, roommate: { ...proposal.roommate, analogy } } } });
  const panel = page.locator(".weekly-analogy"); await panel.scrollIntoViewIfNeeded();
  await expect(panel.locator(".weekly-analogy-part")).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "공통점", exact: true })).toHaveValue(`${long}\n부분을 선택하는 구조`);
  await page.getByRole("textbox", { name: "비유가 성립하지 않는 조건", exact: true }).fill("서로 크기가 다른 조각에는 그대로 적용하지 않는다.");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(panel).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
  await expect(panel).toBeVisible();
  await expect(page.getByRole("textbox", { name: "비유가 성립하지 않는 조건", exact: true })).toHaveValue("서로 크기가 다른 조각에는 그대로 적용하지 않는다.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, ".weekly-analogy", info);
  await panel.screenshot({ path: info.outputPath("비유-편집.png") });
});
