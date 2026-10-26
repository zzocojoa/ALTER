import { randomUUID } from "node:crypto";
import { expect,test } from "@playwright/test";
test("결과 확정 API는 인증·출처·요청 형식·소유자 범위를 검사한다",async({page,request})=>{
  expect((await request.get(`/api/results?id=${randomUUID()}`,{headers:{"oai-authenticated-user-id":"local_seedy"}})).status()).toBe(401);
  expect((await request.post("/api/results",{headers:{origin:"http://127.0.0.1:5173"},data:{}})).status()).toBe(401);
  await page.goto("/signin-with-chatgpt?return_to=/learn/results");await expect(page.getByRole("heading",{name:"수업 결과 확인",exact:true})).toBeVisible();
  expect((await page.request.post("/api/results",{headers:{origin:"https://evil.test"},data:{}})).status()).toBe(403);
  expect((await page.request.post("/api/results",{headers:{origin:"http://127.0.0.1:5173","idempotency-key":randomUUID()},data:{ownerId:"forged"}})).status()).toBe(400);
  const response=await page.request.get(`/api/results?id=${randomUUID()}`);expect(response.status()).toBe(409);expect(response.headers()["cache-control"]).toContain("no-store");expect(await page.pageErrors()).toEqual([]);
});
