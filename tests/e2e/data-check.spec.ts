import { expect, test } from "@playwright/test";

test("데이터 저장 검사는 결과와 임시 기록 정리를 함께 표시한다", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/diagnostics");
  await page.getByText("학습 기록 저장 확인", { exact: true }).click();
  await page.route("**/api/storage/data-check", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "passed", cleanup: "passed", environment: "local-workerd", schema: "fixture", runId: "fixture", startedAt: "fixture", completedAt: "fixture", checks: ["atomic", "cleanup"] }) }));
  await page.getByRole("button", { name: "학습 기록 저장 검사" }).click();
  await expect(page.getByText("2개 저장 검사를 통과했고 임시 기록을 정리했어요.")).toBeVisible();
});

for (const diagnostic of [
  { path: "storage/data-check", section: "학습 기록 저장 확인", button: "학습 기록 저장 검사" },
  { path: "ai/ledger-check", section: "AI 비용 보호 확인", button: "AI 비용 보호 검사" },
]) {
  test(`${diagnostic.section}: 복원 환경 거부를 성공으로 표시하지 않는다`, async ({ page }) => {
    await page.goto("/signin-with-chatgpt?return_to=/learn/diagnostics");
    await page.route(`**/api/${diagnostic.path}`, route => route.fulfill({ status: 423, contentType: "application/json", body: JSON.stringify({ error: "restore_diagnostic_unavailable" }) }));
    await page.getByText(diagnostic.section, { exact: true }).click();
    await page.getByRole("button", { name: diagnostic.button, exact: true }).click();
    await expect(page.getByText(/임시 기록은 만들지 않았어요.*HTTP 423/)).toBeVisible();
    await expect(page.getByTestId("data-check-result")).toHaveCount(0);
    await expect(page.getByTestId("ai-ledger-check-result")).toHaveCount(0);
  });
}
