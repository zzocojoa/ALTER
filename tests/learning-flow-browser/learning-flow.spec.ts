import { confirmTutorAiTransmission } from "../fixtures/tutor-ai-consent";
import { fixtureTutorBudget } from "../fixtures/tutor-budget";
import { randomUUID } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { test,expect } from "@playwright/test";
import { Miniflare } from "miniflare";
import { z } from "zod";
import { learningFlowCases } from "../fixtures/learning-flow-cases";
import { recordId,siteIdentity } from "../../lib/domain/contracts";
import { tutorState } from "../../lib/tutor/contracts";
import { resultDraft } from "../../lib/results/contracts";

const flowSchema=z.object({owner:siteIdentity,courseId:recordId,materialId:recordId,sourceId:recordId,linkId:recordId,scopeId:recordId}).strict();
const resumeSchema=z.object({state:tutorState,latest:z.object({progress:z.string(),performance:z.string()}).nullable(),reviews:z.array(z.unknown())});
let runtime:Miniflare;

test.beforeAll(async()=>{
  runtime=new Miniflare({modules:true,modulesRules:[{type:"CompiledWasm",include:["**/*.wasm"],fallthrough:true}],scriptPath:path.resolve(".sites-runtime/learning-flow-browser/worker.mjs"),compatibilityDate:"2026-05-15",compatibilityFlags:["nodejs_compat"],r2Buckets:["BUCKET"],d1Databases:["DB"],d1Persist:false,r2Persist:false,cf:false,outboundService:async(request:Request):Promise<Response>=>{throw new Error(`외부 통신 금지: ${request.method} ${new URL(request.url).origin}`);}});
  const db=await runtime.getD1Database("DB");
  const journal=z.object({entries:z.array(z.object({tag:z.string()}))}).parse(JSON.parse(await readFile("drizzle/meta/_journal.json","utf8")));
  for(const entry of journal.entries) for(const statement of (await readFile(`drizzle/${entry.tag}.sql`,"utf8")).split("--> statement-breakpoint").map((part:string):string=>part.trim()).filter(Boolean)) await db.prepare(statement).run();
});
test.afterAll(async()=>{await runtime.dispose();});

for(const scenario of learningFlowCases) test(`${scenario.domain}: 수업·개선·공식 확정 화면을 실제 저장소로 연결`,async({page},info)=>{
  const prepared=await runtime.dispatchFetch(`https://local.invalid/prepare?domain=${scenario.domain}`,{method:"POST"});
  expect(prepared.status,await prepared.clone().text()).toBe(200);
  let flow=flowSchema.parse(await prepared.json());let tutorId:string|null=null;let editorId:string|null=null;
  async function call(route:string,input:unknown,key:string):Promise<unknown>{
    const response=await runtime.dispatchFetch(`https://local.invalid${route}?domain=${scenario.domain}`,{method:"POST",body:JSON.stringify({flow,input,requestKey:key})});
    const body:string=await response.text();expect(response.status,body).toBe(200);return JSON.parse(body) as unknown;
  }
  const scripts=await Promise.all(["tutor","editor","result"].map(async(name:string)=>({name,js:await readFile(`.sites-runtime/${name}-browser/fixture.iife.js`,"utf8"),css:await readFile(`.sites-runtime/${name}-browser/fixture.css`,"utf8")})));
  await page.route("**/*",async(route):Promise<void>=>{
    const request=route.request();const url=new URL(request.url());
    if(url.origin!=="https://flow.local.test") throw new Error(`예상하지 않은 브라우저 외부 요청: ${url.origin}`);
    const asset=scripts.find((item)=>url.pathname===`/${item.name}.js` || url.pathname===`/${item.name}.css`);
    if(asset){await route.fulfill({contentType:url.pathname.endsWith(".js")?"text/javascript; charset=utf-8":"text/css; charset=utf-8",body:url.pathname.endsWith(".js")?asset.js:asset.css});return;}
    if (url.pathname === "/api/dashboard/usage") { await route.fulfill({ json: fixtureTutorBudget(Date.now()) }); return; }
    const api=/^\/api\/(tutor|editor|results)$/.exec(url.pathname);
    if(api){
      const input:unknown=request.method()==="POST" ? JSON.parse(request.postData() ?? "null") : url.searchParams.get("id");
      if(request.method()==="POST"){const identity=z.object({id:recordId,action:z.string().optional()}).parse(input);if(identity.action==="start" && api[1]==="tutor") tutorId=identity.id;if(identity.action==="start" && api[1]==="editor") editorId=identity.id;}
      await route.fulfill({json:await call(`/${request.method()==="POST"?"action":"view"}/${api[1]}`,input,request.headers()["idempotency-key"] ?? randomUUID())});return;
    }
    const screen=url.pathname==="/learn/tutor" ? "tutor" : url.pathname==="/learn/editor" ? "editor" : url.pathname==="/learn/results" ? "results" : null;
    if(!screen) throw new Error(`예상하지 않은 브라우저 경로: ${url.pathname}`);
    const id=url.searchParams.get("id") ?? (screen==="tutor"?tutorId:screen==="editor"?editorId:null);
    const view=id ? await call(`/view/${screen}`,id,randomUUID()) : null;
    if(screen==="results" && !view) throw new Error("결과 화면 회차 ID가 없습니다.");
    const name=screen==="results" ? "result" : screen;
    const data=JSON.stringify(screen==="results"?{draft:view,history:[]}:{overview:{history:[],scopes:[{id:flow.scopeId,title:scenario.title,date:"2026-10-25"}]},view}).replaceAll("<","\\u003c");
    await route.fulfill({contentType:"text/html; charset=utf-8",body:`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${name}.css"><main id="${name}-fixture"></main><script id="${name}-initial" type="application/json">${data}</script><script src="/${name}.js"></script></html>`});
  });
  await page.goto("https://flow.local.test/learn/tutor");
  await page.getByRole("button",{name:"수업 시작",exact:true}).click();
  await confirmTutorAiTransmission(page,"작은 개념 설명 받기");await page.getByRole("button",{name:"작은 개념 설명 받기",exact:true}).click();
  await expect(page.getByText(scenario.definition,{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"자료와 설명 가리고 시작",exact:true}).click();
  await expect(page.getByText(scenario.definition,{exact:true})).toHaveCount(0);await expect(page.locator("blockquote")).toHaveCount(0);
  await expect(page.getByTestId("tutor-question")).toHaveText(scenario.question);
  await expect(page.getByRole("button",{name:"답안 제출·저장",exact:true})).toBeDisabled();
  await page.getByLabel("나의 답안",{exact:true}).fill(scenario.explanationAnswer);await expect(page.getByText("서버 초안 저장을 확인했어요",{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByLabel("나의 답안",{exact:true})).toHaveValue(scenario.explanationAnswer);
  await page.getByRole("button",{name:"답안 제출·저장",exact:true}).click();await confirmTutorAiTransmission(page,"저장한 답안 진단");await page.getByRole("button",{name:"저장한 답안 진단",exact:true}).click();
  await page.getByRole("button",{name:"수업 마치기",exact:true}).click();await page.getByRole("link",{name:"이 수업 결과 확인·확정",exact:true}).click();
  await expect(page.getByText("단원 통과: 미통과 · 지연 재현: 미확인",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"내용 확인 후 공식 기록 확정",exact:true}).click();await expect(page.getByText("공식 확정 기록",{exact:true})).toBeVisible();
  flow=flowSchema.parse(await call("/scope",null,randomUUID()));
  await page.goto("https://flow.local.test/learn/editor");await page.getByRole("button",{name:"개선할 초안 시작",exact:true}).click();
  await page.getByLabel("나의 초안",{exact:true}).fill("계산 순서를 반대로 적용한 초안입니다.");await expect(page.getByText("서버 초안 저장을 확인했어요",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"초안 제출·저장",exact:true}).click();await confirmTutorAiTransmission(page,"저장한 초안 피드백 받기");await page.getByRole("button",{name:"저장한 초안 피드백 받기",exact:true}).click();
  await expect(page.getByRole("heading",{name:"초안 1판 피드백",exact:true})).toBeVisible();
  await page.getByLabel("나의 수정본",{exact:true}).fill(scenario.revision);await expect(page.getByRole("button",{name:"수정본과 이유 제출·저장",exact:true})).toBeDisabled();
  await page.getByRole("textbox",{name:"수정 이유",exact:true}).fill(scenario.reason);await expect(page.getByText("서버 초안 저장을 확인했어요",{exact:true})).toBeVisible();await page.reload();
  await expect(page.getByLabel("나의 수정본",{exact:true})).toHaveValue(scenario.revision);await expect(page.getByRole("textbox",{name:"수정 이유",exact:true})).toHaveValue(scenario.reason);
  await page.getByRole("button",{name:"수정본과 이유 제출·저장",exact:true}).click();await confirmTutorAiTransmission(page,"수정본과 이유 재검토");await page.getByRole("button",{name:"수정본과 이유 재검토",exact:true}).click();
  const improved=resumeSchema.parse(await call("/state",editorId,randomUUID()));expect(improved.state.answers.at(-1)?.helped).toBe(true);expect(improved.state.pending).toBeNull();
  await confirmTutorAiTransmission(page,"새 조건에서 직접 풀기");await page.getByRole("button",{name:"새 조건에서 직접 풀기",exact:true}).click();await expect(page.getByTestId("tutor-question")).toHaveText(scenario.variation);
  await expect(page.getByText("초안·수정 이유 이력 (2)",{exact:true})).toHaveCount(0);await expect(page.locator("blockquote")).toHaveCount(0);
  await page.getByLabel("나의 답안",{exact:true}).fill(scenario.variationAnswer);await expect(page.getByText("서버 초안 저장을 확인했어요",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"답안 제출·저장",exact:true}).click();await confirmTutorAiTransmission(page,"저장한 답안 진단");await page.getByRole("button",{name:"저장한 답안 진단",exact:true}).click();
  await page.getByRole("button",{name:"수업 마치기",exact:true}).click();await page.getByRole("link",{name:"이 수업 결과 확인·확정",exact:true}).click();
  await expect(page.getByText("단원 통과: 통과 · 지연 재현: 미확인",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"내용 확인 후 공식 기록 확정",exact:true}).click();await expect(page.getByText("공식 확정 기록",{exact:true})).toBeVisible();await page.reload();await expect(page.getByText("공식 확정 기록",{exact:true})).toBeVisible();
  const result=resultDraft.parse(await call("/view/results",editorId,randomUUID()));const resumed=resumeSchema.parse(await call("/state",editorId,randomUUID()));
  expect(result.judgment.explanation?.sessionId).toBe(tutorId);expect(result.judgment.variation?.sessionId).toBe(editorId);expect(resumed.state.phase).toBe("finished");expect(resumed.latest?.performance).toBe("독립 수행");expect(resumed.reviews.length).toBeGreaterThan(0);expect(resumed.state.editor?.versions[1].reason).toBe(scenario.reason);expect(resumed.state.variations[0].helpEventIds).toHaveLength(2);
  expect(await page.evaluate(():boolean=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.pageErrors()).toEqual([]);
  await page.screenshot({path:`outputs/learning-flow-${scenario.domain}-${info.project.name}.png`,fullPage:true});
  const proof={status:"passed",domain:scenario.domain,browser:info.project.name,storage:"local-workerd-d1-r2",model:"deterministic-mock",actualPhone:false,actualProviderCalls:0,preparation:"Advisor/source extraction/Librarian through repository fixture; Tutor/Editor/result through UI",tutorId,editorId,courseId:flow.courseId,finalVersion:resumed.state.version,unitPassed:result.judgment.unitPassed,delayedRecall:result.judgment.delayedRecall,externalNetwork:"blocked",checkedAt:new Date().toISOString()};
  await writeFile(`.taskmaster/reports/task-18-flow-${scenario.domain}-${info.project.name}.json`,JSON.stringify(proof,null,2)+"\n");
});
