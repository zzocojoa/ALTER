import { tutorView } from "../../lib/tutor/view";
import { resultDraft } from "../../lib/results/contracts";
import { reviewOverview } from "../../lib/reviews/view";
import { randomUUID } from "node:crypto";
import { expect,test } from "@playwright/test";
test("복습 API는 소유자·Origin·서버 필드·참조를 검사한다",async({page,request})=>{
  expect((await request.get("/api/reviews",{headers:{"oai-authenticated-user-id":"local_seedy"}})).status()).toBe(401);expect((await request.post("/api/reviews",{headers:{origin:"http://127.0.0.1:5173"},data:{}})).status()).toBe(401);expect((await request.get("/api/reviews/acceptance")).status()).toBe(401);
  await page.goto("/signin-with-chatgpt?return_to=/learn/tutor");await expect(page.getByRole("heading",{name:"한 걸음 수업",exact:true})).toBeVisible();
  expect((await page.request.post("/api/reviews",{headers:{origin:"https://evil.test"},data:{}})).status()).toBe(403);expect((await page.request.post("/api/reviews/acceptance",{headers:{origin:"https://evil.test"},data:{}})).status()).toBe(403);
  expect((await page.request.post("/api/reviews",{headers:{origin:"http://127.0.0.1:5173","idempotency-key":randomUUID()},data:{action:"prepare",id:randomUUID(),expectedVersion:1,ownerId:"forged"}})).status()).toBe(400);
  expect((await page.request.post("/api/reviews",{headers:{origin:"http://127.0.0.1:5173","idempotency-key":randomUUID()},data:{action:"prepare",id:randomUUID(),expectedVersion:1}})).status()).toBe(409);
  const response=await page.request.get("/api/reviews");expect(response.status()).toBe(200);expect(response.headers()["cache-control"]).toContain("no-store");expect(reviewOverview.safeParse(await response.json()).success).toBe(true);expect(await page.pageErrors()).toEqual([]);
});

test("실제 복습 시작은 기존 답안을 즉시 가리고 새 Tutor 회차로 전환한다",async({page},testInfo)=>{
  await page.goto("/signin-with-chatgpt?return_to=/learn/tutor");
  const headers={origin:"http://127.0.0.1:5173","idempotency-key":randomUUID()};
  async function post(path:string,input:unknown):Promise<unknown>{const response=await page.request.post(path,{headers:{...headers,"idempotency-key":randomUUID()},data:input});expect(response.status(),await response.text()).toBe(200);return response.json();}
  const overview=await (await page.request.get("/api/tutor")).json();const id=randomUUID();const previous="이전 수업의 설명과 답안은 복습 시작 요청 즉시 가려져야 합니다.";
  let state=tutorView.parse(await post("/api/tutor",{action:"start",id,scopeId:overview.scopes[testInfo.project.name==="desktop-chromium" ? 0 : 1].id,questionId:randomUUID(),attemptId:randomUUID()}));state=tutorView.parse(await post("/api/tutor",{action:"direct",id,expectedVersion:state.version}));state=tutorView.parse(await post("/api/tutor",{action:"submit",id,expectedVersion:state.version,answerId:randomUUID(),draft:{text:previous,fileIds:[]}}));await post("/api/tutor",{action:"finish",id,expectedVersion:state.version});
  const draft=resultDraft.parse(await (await page.request.get(`/api/results?id=${id}`)).json());const confirmed=resultDraft.parse(await post("/api/results",{id,expectedVersion:draft.version,expectedSessionVersion:draft.sessionVersion,expectedOfficialVersion:draft.officialVersion,fingerprint:draft.fingerprint}));
  const overviewReviews=reviewOverview.parse(await (await page.request.get("/api/reviews")).json());const plan=overviewReviews.plans.find(item=>item.evidence.resultVersionId===confirmed.confirmation?.id);if(!plan) throw new Error("새 확정 회차의 복습 계획 누락");await post("/api/reviews",{action:"choose",id:plan.id,expectedVersion:plan.version,type:"concept",conditions:plan.proposal.conditions,dueDate:overviewReviews.today,reason:"회차 전환 비노출 회귀 검증"});
  await page.goto(`/learn/tutor?id=${id}`);await expect(page.getByText(previous,{exact:true})).toBeVisible();const card=page.getByTestId(`review-${plan.id}`);await card.locator("summary").first().click();
  await page.route("**/api/reviews",async(route)=>{if(route.request().method()==="POST" && route.request().postDataJSON().action==="start") await expect(page.getByText(previous,{exact:true})).toHaveCount(0);await route.continue();});
  await card.getByRole("button",{name:"자료 가리고 복습 시작",exact:true}).click();await expect(page).not.toHaveURL(new RegExp(`id=${id}`));await expect(page.getByText(previous,{exact:true})).toHaveCount(0);await expect(page.getByRole("textbox",{name:"새 예시",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"오늘과 다음 복습",exact:true})).toHaveCount(0);
  const nextId=new URL(page.url()).searchParams.get("id");if(!nextId) throw new Error("새 회차 URL 누락");await page.getByRole("textbox",{name:"새 예시",exact:true}).fill("같은 크기 조각을 나누는 시험");await page.getByRole("textbox",{name:"자신의 설명",exact:true}).fill("분수의 개념을 확인합니다.");await expect(page.getByRole("status")).toContainText("초안 저장됨");await page.reload();await expect(page.getByRole("textbox",{name:"새 예시",exact:true})).toHaveValue("같은 크기 조각을 나누는 시험");await expect(page.getByRole("textbox",{name:"자신의 설명",exact:true})).toHaveValue("분수의 개념을 확인합니다.");await page.getByRole("button",{name:"답안 제출·저장",exact:true}).click();await expect(page.getByRole("button",{name:"저장한 답안 진단",exact:true})).toBeVisible();const answer=tutorView.parse(await (await page.request.get(`/api/tutor?id=${nextId}`)).json());await post("/api/tutor",{action:"finish",id:nextId,expectedVersion:answer.version});
});
