import { randomUUID } from "node:crypto";
import { expect,test } from "@playwright/test";
import { weeklyView } from "../../lib/weekly/view";

test("주간 API 소유자·Origin·서버 필드·확정본 접근을 제한한다",async({page,request})=>{
  expect((await request.get("/api/weekly",{headers:{"oai-authenticated-user-id":"local_seedy"}})).status()).toBe(401);expect((await request.get("/api/weekly/acceptance")).status()).toBe(401);expect((await request.get(`/api/weekly?version=${randomUUID()}`)).status()).toBe(401);
  await page.goto("/signin-with-chatgpt?return_to=/learn/weekly");await expect(page.getByRole("heading",{name:"주간 점검",exact:true})).toBeVisible();
  expect((await page.request.post("/api/weekly",{headers:{origin:"https://evil.test"},data:{}})).status()).toBe(403);expect((await page.request.post("/api/weekly/acceptance",{headers:{origin:"https://evil.test"},data:{}})).status()).toBe(403);
  expect((await page.request.post("/api/weekly",{headers:{origin:"http://127.0.0.1:5173","idempotency-key":randomUUID()},data:{action:"refresh",id:randomUUID(),expectedVersion:1,ownerId:"forged"}})).status()).toBe(400);
  expect((await page.request.get(`/api/weekly?version=${randomUUID()}`)).status()).toBe(409);const response=await page.request.get("/api/weekly");expect(response.status()).toBe(200);expect(response.headers()["cache-control"]).toContain("no-store");expect(await page.pageErrors()).toEqual([]);
});
test("실제 주간 초안은 빈 주간·0분·버전 충돌과 재조회 상태를 보존한다",async({page},info)=>{
  await page.goto("/signin-with-chatgpt?return_to=/learn/weekly");const overview=await (await page.request.get("/api/weekly")).json();const id=randomUUID();const input={action:"start",input:{id,courseId:overview.courses[0].id,date:info.project.name==="desktop-chromium" ? "2020-01-06" : "2020-01-13",availableMinutes:0}};const headers={origin:"http://127.0.0.1:5173","idempotency-key":randomUUID()};
  const response=await page.request.post("/api/weekly",{headers,data:input});expect(response.status(),await response.text()).toBe(200);const view=weeklyView.parse(await response.json());expect(view.state.context.aggregate.counts.sessions).toBe(0);expect(view.state.context.availableMinutes).toBe(0);expect((await page.request.post("/api/weekly",{headers,data:input})).status()).toBe(200);
  await page.goto(`/learn/weekly?id=${id}`);await expect(page.getByText("이 주에는 확정된 학습 기록이 없어요. 성과로 합산하지 않아요.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"이 주간 내용 확정하고 내보내기 요청"})).toBeDisabled();await page.getByRole("spinbutton",{name:"다음 주 가용 시간 저장 (분)",exact:true}).fill("15");await page.getByRole("button",{name:"시간 저장",exact:true}).click();await expect(page.getByText(/기록 2판 · 초안/)).toBeVisible();await page.reload();await expect(page.getByRole("spinbutton",{name:"다음 주 가용 시간 저장 (분)",exact:true})).toHaveValue("15");
  expect((await page.request.post("/api/weekly",{headers:{...headers,"idempotency-key":randomUUID()},data:{action:"time",id,expectedVersion:1,availableMinutes:30}})).status()).toBe(409);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.pageErrors()).toEqual([]);
});

/** 시험 패널의 서버 탐색 후 본문이 이전 초안을 계속 표시하지 않아야 합니다. */
test("시험 준비의 서버 탐색은 새 주간 본문을 즉시 반영한다",async({page},info)=>{
  await page.goto("/signin-with-chatgpt?return_to=/learn/weekly");
  const overview=await (await page.request.get("/api/weekly")).json();
  const id=randomUUID();const date=info.project.name==="desktop-chromium" ? "2020-02-03" : "2020-02-10";
  const response=await page.request.post("/api/weekly",{headers:{origin:"http://127.0.0.1:5173","idempotency-key":randomUUID()},data:{action:"start",input:{id,courseId:overview.courses[0].id,date,availableMinutes:60}}});
  expect(response.status(),await response.text()).toBe(200);const view=weeklyView.parse(await response.json());
  await page.route("**/api/weekly/acceptance",async route=>{await route.fulfill({json:{view:route.request().method()==="GET" ? null : view}});});
  await page.getByText("고급 · 소유자 진단 — 주간 점검", { exact: true }).click();
  await page.getByText("Task 13 고정 주간 검증",{exact:true}).click();await page.getByRole("button",{name:"시험 주간 기록 확인",exact:true}).click();await page.getByRole("button",{name:"고정 주간 시험 준비",exact:true}).click();
  await expect(page.getByRole("heading",{name:`${date} 주간`,exact:true})).toBeVisible();
  await expect(page.getByRole("spinbutton",{name:"다음 주 가용 시간 저장 (분)",exact:true})).toHaveValue("60");
  expect(await page.pageErrors()).toEqual([]);
});
