import { expect, test } from "@playwright/test";

test("실제 AI 검사는 소유자·출처·운영 설정이 없으면 호출하지 않는다", async ({ page, request }) => {
  expect((await request.post("/api/ai/support-check")).status()).toBe(401);
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  expect((await page.request.post("/api/ai/support-check", { headers: { origin: "https://evil.test" } })).status()).toBe(403);
  const origin: string = new URL(page.url()).origin;
  expect((await page.request.post("/api/ai/support-check", { headers: { origin }, data: { model: "other", input: "untrusted" } })).status()).toBe(400);
  await page.getByText("AI 연결 확인", { exact: true }).click();
  await page.getByRole("button", { name: "AI 연결 검사 (API 비용 발생)", exact: true }).click();
  await expect(page.getByText("AI 운영 설정이 준비되지 않아 호출하지 않았어요. 결제·예산·키 설정을 완료한 뒤 확인해 주세요.", { exact: true })).toBeVisible();
  expect(await page.pageErrors()).toEqual([]);
});
