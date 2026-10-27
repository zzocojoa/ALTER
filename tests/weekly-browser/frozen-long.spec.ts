import { expect, test } from "@playwright/test";
import { weeklyFrozenFixture, mountWeeklyFrozen } from "../fixtures/weekly-frozen-browser";
import { checkAccessibility } from "../fixtures/accessibility";

test("긴 한국어 확정본은 비유 세 구획·자기 보고·시간 합계를 읽기 전용으로 보존", async ({ page }, info): Promise<void> => {
  const base = await weeklyFrozenFixture(); const proposal = base.state.proposal; if (!proposal) throw new Error("확정 비유 시험 누락");
  const long = "다른조건에서같은설명이어디까지통하는지공통점과차이점을비교하고성립하지않는상황을별도로기록합니다".repeat(15);
  const data = { ...base, state: { ...base.state, notes: `${long}\n직접 돌아본 메모`, proposal: { ...proposal, uncertainty: [long], roommate: { ...proposal.roommate, analogy: { ...proposal.roommate.analogy, example: long, similarities: [long], differences: [long], limitations: [long] } } } } };
  await mountWeeklyFrozen(page, data, async (route): Promise<void> => { await route.fulfill({ json: data }); });
  for (const label of ["공통점", "차이점", "비유가 성립하지 않는 조건"]) {
    const section = page.locator(".weekly-analogy-part").filter({ has: page.getByRole("heading", { name: label, exact: true }) });
    await expect(section).toContainText(long); await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.locator(".weekly-note")).toHaveText(`${long}\n직접 돌아본 메모`);
  await expect(page.locator("input,textarea,form,select")).toHaveCount(0);
  await checkAccessibility(page, ".weekly-workspace", info);
  await page.locator(".weekly-analogy").screenshot({ path: info.outputPath("확정본-비유.png") });
  await page.reload(); await expect(page.locator(".weekly-note")).toHaveText(`${long}\n직접 돌아본 메모`);
});
