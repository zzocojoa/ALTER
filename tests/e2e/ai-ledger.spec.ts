import { expect, test } from "@playwright/test";

test("AI 비용 검사는 인증·출처를 보호하고 임시 원장만 정리한다", async ({ page, request }) => {
  expect((await request.post("/api/ai/ledger-check")).status()).toBe(401);
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  expect((await page.request.post("/api/ai/ledger-check", { headers: { origin: "https://evil.test" } })).status()).toBe(403);
  await page.getByText("AI 비용 보호 확인", { exact: true }).click();
  await page.getByRole("button", { name: "AI 비용 보호 검사", exact: true }).click();
  await expect(page.getByText("6개 비용 검사를 통과했고 임시 기록을 정리했어요. AI 호출은 0회입니다.", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText("비용 검사 결과 보기", { exact: true }).click();
  await expect(page.getByTestId("ai-ledger-check-result")).toContainText('"providerEvidence": "synthetic-no-network"');
  await expect(page.getByTestId("ai-ledger-check-result")).toContainText('"cleanup": "passed"');
  expect(await page.pageErrors()).toEqual([]);
});
