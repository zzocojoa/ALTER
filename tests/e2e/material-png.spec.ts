import { expect, test } from "@playwright/test";

test("소유자 화면에서 실제 PNG 처리 7개 결과를 확인한다", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  await expect(page.getByRole("button", { name: "이미지 검증 환경 확인", exact: true, includeHidden: true })).toBeEnabled();
  await page.getByText("이미지 검증 환경", { exact: true }).click();
  await page.getByRole("button", { name: "이미지 검증 환경 확인", exact: true }).click();
  await expect(page.locator("#material-png-result")).toContainText("7개 이미지 검사를 통과했어요. 자료 보관함에서 자료를 등록하고 원본을 확인할 수 있어요.", { timeout: 25_000 });
  await page.getByText("이미지 검사 결과", { exact: true }).click();
  await expect(page.getByText('"decodedBytes": 128000000', { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "이미지 검증 환경 확인", exact: true })).toBeEnabled();
  expect(await page.pageErrors()).toEqual([]);
});
