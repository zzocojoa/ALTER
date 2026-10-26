import { expect, test } from "@playwright/test";

test("Google API는 소유자와 Origin을 확인하고 미설정 OAuth를 차단한다", async ({ page, request }) => {
  test.setTimeout(60_000);
  expect((await request.get("/api/google")).status()).toBe(401);
  expect((await request.post("/api/google/oauth/start", { data: { kind: "connect" } })).status()).toBe(401);
  for (const path of ["/api/google/storage", "/api/google/picker", "/api/google/picker/select", "/api/google/picker/cancel"]) expect((await request.post(path, { data: {} })).status()).toBe(401);
  const callback = await request.get("/api/google/oauth/callback?state=forged&code=do-not-exchange");
  expect(callback.status()).toBe(401); expect(callback.headers()["set-cookie"]).toContain("Max-Age=0");
  await page.goto("/signin-with-chatgpt?return_to=/learn/google");
  await expect(page.getByRole("heading", { name: "Google 연결", exact: true })).toBeVisible();
  expect((await page.request.post("/api/google/oauth/start", { headers: { origin: "https://evil.test" }, data: { kind: "connect" } })).status()).toBe(403);
  expect((await page.request.post("/api/google/disconnect", { headers: { origin: "https://evil.test" }, data: {} })).status()).toBe(403);
  for (const path of ["/api/google/storage", "/api/google/picker", "/api/google/picker/select", "/api/google/picker/cancel"]) expect((await page.request.post(path, { headers: { origin: "https://evil.test" }, data: {} })).status()).toBe(403);
  const status = await page.request.get("/api/google"); expect(status.status()).toBe(200); expect(status.headers()["cache-control"]).toContain("no-store");
  const body = await status.json(); expect(body.configured).toBe(false); expect(body.connection).toBeNull(); expect(JSON.stringify(body)).not.toMatch(/clientSecret|refreshToken|accessToken|ciphertext|keyring/);
  const start = await page.request.post("/api/google/oauth/start", { headers: { origin: "http://127.0.0.1:5173" }, data: { kind: "connect" } });
  expect(start.status()).toBe(409); expect((await start.json()).error).toBe("google_configuration_invalid");
  expect(await page.pageErrors()).toEqual([]);
});

test("Google 연결 준비 상태는 새로고침과 좁은 화면에서도 명확하다", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/google");
  await expect(page.getByRole("heading", { name: "아직 연결하지 않았어요", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google 연결하기", exact: true })).toBeDisabled();
  await expect(page.getByText("Google 연결 준비가 필요해요. 사용할 계정과 무료 이용 조건을 확인한 뒤 연결할 수 있어요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "연결 상태 새로 확인", exact: true })).toBeEnabled();
  await page.reload(); await expect(page.getByRole("heading", { name: "Google 연결", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/learn"); await page.getByRole("link", { name: "Google 연결 관리", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Google 연결", exact: true })).toBeVisible();
  expect(await page.pageErrors()).toEqual([]);
});
