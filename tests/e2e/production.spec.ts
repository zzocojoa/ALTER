import { expect, test } from "@playwright/test";

test("실제 빌드한 Worker가 한국어 화면을 응답한다", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const body: string = await response.text();
  expect(body).toContain('lang="ko"');
  expect(body).toContain("나의 속도로,");
  expect(body).toContain("스스로 배우기");
});

test("빌드한 Worker는 로컬 로그인 쿠키를 만들지 않는다", async ({ request }) => {
  const response = await request.get("/signin-with-chatgpt?return_to=/", { maxRedirects: 0 });
  expect(response.status()).toBe(404);
  expect(response.headers()["set-cookie"]).toBeUndefined();
});

test("빌드한 Worker에서도 대화상자 입력을 적용한다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "환영 문구 바꾸기" }).click();
  await expect(page.getByRole("dialog", { name: "어떻게 불러드릴까요?" })).toBeVisible();
  await page.getByRole("textbox", { name: "표시 이름" }).fill("학습자");
  await page.getByRole("button", { name: "적용하기" }).click();
  await expect(page.getByText("학습자님, 반가워요.")).toBeVisible();
  expect(await page.pageErrors()).toEqual([]);
});


test("소유자 설정 없는 운영 Worker는 임의 신원과 개발 쿠키를 거부한다", async ({ request }) => {
  const response = await request.get("/api/session", { headers: { "oai-authenticated-user-id": "forged", "oai-authenticated-user-email": "forged@example.test", cookie: "__sites_local_auth=1" } });
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({ error: "authentication_configuration_required", setting: "ALTER_OWNER_USER_ID" });
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await request.post("/api/setup/candidate")).status()).toBe(404);
});


test("운영 AI 상태 조회는 소유자 설정 없이 DB나 외부 호출에 도달하지 않는다", async ({ request }) => {
  const response = await request.get("/api/ai/requests/forged", { headers: { "oai-authenticated-user-id": "forged", cookie: "__sites_local_auth=1" } });
  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ error: "authentication_configuration_required", setting: "ALTER_OWNER_USER_ID" });
});


test("운영 AI 원장 검사는 위조 신원으로 실행할 수 없다", async ({ request }) => {
  const response = await request.post("/api/ai/ledger-check", { headers: { "oai-authenticated-user-id": "forged", cookie: "__sites_local_auth=1" } });
  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ error: "authentication_configuration_required", setting: "ALTER_OWNER_USER_ID" });
});

test("운영 실제 AI 검사도 위조 신원을 거부한다", async ({ request }) => {
  const response = await request.post("/api/ai/support-check", { headers: { "oai-authenticated-user-id": "forged", cookie: "__sites_local_auth=1" } });
  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ error: "authentication_configuration_required", setting: "ALTER_OWNER_USER_ID" });
});


test("Editor 일반·고정 시험 API 모두 소유자 설정 전에 차단한다", async ({ request }) => {
  for (const path of ["/api/editor", "/api/editor/acceptance"]) {
    for (const method of ["GET", "POST"]) {
      const response = await request.fetch(path, { method, headers: { "oai-authenticated-user-id": "forged", cookie: "__sites_local_auth=1" } });
      expect(response.status()).toBe(503);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(await response.json()).toEqual({ error: "authentication_configuration_required" });
    }
  }
});


test("Google 운영 API는 소유자 설정 전에 토큰·DB·제공사 호출을 차단한다", async ({ request }) => {
  const calls: readonly Readonly<{ path: string; method: "GET" | "POST" }>[] = [{ path: "/api/google", method: "GET" }, { path: "/api/google/oauth/callback?state=forged&code=never-exchange", method: "GET" }, ...["/api/google/acceptance", "/api/google/oauth/start", "/api/google/disconnect", "/api/google/storage", "/api/google/picker", "/api/google/picker/select", "/api/google/picker/cancel"].map(path => ({ path, method: "POST" as const }))];
  for (const call of calls) {
    const response = await request.fetch(call.path, { method: call.method, headers: { "oai-authenticated-user-id": "forged", cookie: "__sites_local_auth=1" } });
    expect(response.status()).toBe(503); expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({ error: "authentication_configuration_required" });
  }
});

test("외부 작업 조회와 재개는 운영 Worker에서도 소유자 인증 전에 차단한다", async ({ request }) => {
  for (const method of ["GET", "POST"]) {
    const response = await request.fetch("/api/external", { method, headers: { "oai-authenticated-user-id": "forged", cookie: "__sites_local_auth=1" } });
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({ error: "authentication_configuration_required" });
  }
});
