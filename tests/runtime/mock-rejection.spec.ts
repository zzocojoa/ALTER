import { expect, test } from "@playwright/test";

test("운영 Worker에 모의 인증 설정을 주입하면 모든 동작을 중단한다", async ({ request }) => {
  for (const path of ["/", "/learn", "/api/session", "/api/files/2098834d-60e9-4e33-a856-b381fbca16ef"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(503);
    expect(await response.json()).toEqual({ error: "runtime_mock_auth_forbidden" });
  }
  const action = await request.post("/learn", { headers: { "next-action": "forged-action", origin: "http://127.0.0.1:8789" }, data: [] });
  expect(action.status()).toBe(503);
});
