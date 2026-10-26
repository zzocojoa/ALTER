import { expect, test } from "@playwright/test";

const endpoint: string = "**/api/materials/storage-check";
test.beforeEach(async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
  await expect(page.getByRole("button", { name: "저장 공간 확인", exact: true })).toBeEnabled();
});
test("실측 실패 안내 후 실제 재검증할 수 있다", async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ status: 503, json: { error: "synthetic_unavailable" } }), { times: 1 });
  await page.getByRole("button", { name: "저장 공간 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("저장 상태를 확인");
  await page.getByRole("button", { name: "저장 공간 확인", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("실제 저장 공간과 쓰기·읽기를 확인했어요");
});
test("잘못된 성공 응답은 실측 통과로 표시하지 않는다", async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ status: 200, json: { status: "verified" } }), { times: 1 });
  await page.getByRole("button", { name: "저장 공간 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("status")).not.toContainText("실제 저장 공간과 쓰기·읽기를 확인했어요");
});
test("실측 요청의 인증 만료를 안내한다", async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ status: 401, json: { error: "authentication_required" } }), { times: 1 });
  await page.getByRole("button", { name: "저장 공간 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("로그인이 만료됐어요");
});
