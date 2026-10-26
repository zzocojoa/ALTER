import { expect, test } from "@playwright/test";

test("소유자가 텍스트 UTF-8 검증 4개 결과를 확인한다", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  await expect(page.getByRole("button", { name: "텍스트 검증 환경 확인", exact: true, includeHidden: true })).toBeEnabled();
  await page.getByText("텍스트 검증 환경", { exact: true }).click();
  await page.getByRole("button", { name: "텍스트 검증 환경 확인", exact: true }).click();
  await expect(page.locator("#material-text-result")).toContainText("4개 텍스트 검사를 통과했어요. 자료 보관함에서 자료를 등록하고 원본을 확인할 수 있어요.", { timeout: 60_000 });
  await page.getByText("텍스트 검사 결과", { exact: true }).click();
  await expect(page.getByText('"bytes": 1048576', { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "텍스트 검증 환경 확인", exact: true })).toBeEnabled();
  expect(await page.pageErrors()).toEqual([]);
});
