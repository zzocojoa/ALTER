import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const origin: string = "http://127.0.0.1:5173";

test("비로그인·위조 헤더·본문으로 API와 파일을 열 수 없다", async ({ request }) => {
  for (const path of ["/api/session", "/api/ai/requests/forged", `/api/files/${randomUUID()}`]) {
    const response = await request.get(path, { headers: { "oai-authenticated-user-id": "local_seedy", "oai-authenticated-user-email": "forged@example.test" } });
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("local_seedy");
  }
  const put = await request.put(`/api/files/${randomUUID()}`, { headers: { origin }, data: "forged-owner" });
  expect(put.status()).toBe(401);
  const probe = await request.post("/api/storage/probe", { headers: { origin }, data: { userId: "local_seedy" } });
  expect(probe.status()).toBe(401);
});

test("소유자 로그인·파일 보호·저장소·로그아웃을 연결한다", async ({ page, request }) => {
  await page.goto("/");
  const login = page.getByRole("link", { name: "내 학습 공간 열기" });
  await expect(login).toHaveAttribute("target", "_top");
  await login.click();
  await expect(page.getByRole("heading", { name: "나의 학습 공간" })).toBeVisible();
  const session = await page.request.get("/api/session");
  expect(session.status()).toBe(200);
  expect(session.headers()["cache-control"]).toContain("no-store");
  expect(await session.json()).toEqual({ authenticated: true, role: "owner" });
  const id: string = randomUUID();
  const path: string = `/api/files/${id}`;
  expect((await page.request.put(path, { headers: { origin }, data: "private fixture" })).status()).toBe(410);
  expect((await request.get(path)).status()).toBe(401);
  expect((await page.request.get("/api/files/not-a-uuid")).status()).toBe(400);
  expect((await page.request.delete(path, { headers: { origin: "https://evil.test" } })).status()).toBe(403);
  expect((await page.request.delete(path, { headers: { origin } })).status()).toBe(410);
  expect((await page.request.get(path)).status()).toBe(404);
  expect((await page.request.post("/api/storage/probe", { headers: { origin } })).status()).toBe(410);
  const inventory = await page.request.post("/api/materials/storage-check", { headers: { origin } });
  expect(inventory.status()).toBe(200);
  expect((await inventory.json()).status).toBe("verified");
  await page.getByRole("link", { name: "로그아웃" }).click();
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "내 학습 공간에 로그인" })).toBeVisible();
  expect(await page.pageErrors()).toEqual([]);
});

test("소유자 설정 후 후보 등록과 인증 정보 없는 Google 복귀를 거부한다", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  expect((await page.request.post("/api/setup/candidate", { headers: { origin } })).status()).toBe(404);
  const callback = await page.request.get("/api/google/oauth/callback", { maxRedirects: 0 });
  expect(callback.status()).toBe(303);
  expect(callback.headers().location).toBe("/learn/google?connection=failed");
  expect(callback.headers()["cache-control"]).toBe("private, no-store");
  expect(callback.headers()["set-cookie"]).toContain("Max-Age=0");
  const google = await page.request.get("/api/google");
  expect(google.status()).toBe(200);
  expect((await google.json()).connection).toBeNull();
  expect((await page.request.post("/api/storage/probe", { headers: { origin: "https://evil.test" } })).status()).toBe(403);
});

test("로컬 인증 쿠키가 만료되면 이전 학습 화면과 API를 재사용하지 않는다", async ({ page, context }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  await expect(page.getByRole("heading", { name: "나의 학습 공간" })).toBeVisible();
  const cookie = (await context.cookies()).find((item) => item.name === "__sites_local_auth");
  if (!cookie) throw new Error("로컬 인증 검사용 쿠키를 찾을 수 없습니다.");
  await context.addCookies([{ ...cookie, expires: Math.floor(Date.now() / 1000) + 2 }]);
  await page.goto("/api/session");
  await expect.poll(async () => (await page.request.get("/api/session")).status(), { timeout: 7000 }).toBe(401);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "내 학습 공간에 로그인" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "나의 학습 공간", exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/files/${randomUUID()}`)).status()).toBe(401);
});
