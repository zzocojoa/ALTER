import { expect, test } from "@playwright/test";

test("이전 PDF 진단 경로는 소유자에게도 R2 쓰기를 허용하지 않는다", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  const response = await page.request.post("/api/storage/pdf-check", { headers: { origin: "http://127.0.0.1:5173" } });
  expect(response.status()).toBe(410);
  expect((await response.json()).replacement).toBe("/learn/materials");
});
