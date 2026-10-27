import { expect, test } from "@playwright/test";

test("소유자가 자료 상태 검사와 임시 기록 정리를 확인한다", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/diagnostics");
  await expect(page.getByRole("button", { name: "자료 저장 상태 검사", exact: true, includeHidden: true })).toBeEnabled();
  await page.getByText("자료 저장 상태 확인", { exact: true }).click();
  await page.getByRole("button", { name: "자료 저장 상태 검사", exact: true }).click();
  await expect(page.getByText("16개 자료 상태 검사를 통과했고 임시 기록을 정리했어요.", { exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByText("자료 상태 검사 결과", { exact: true }).click();
  await expect(page.getByTestId("material-state-result")).toContainText('"realR2Writes": 0');
  expect(await page.pageErrors()).toEqual([]);
});
