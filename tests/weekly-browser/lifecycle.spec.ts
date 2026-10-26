import { readFile } from "node:fs/promises";
import { expect,test } from "@playwright/test";
import type { Page,Route } from "@playwright/test";
import { weeklyPlanFixture } from "../fixtures/weekly-plan";
import { weeklyAction } from "../../lib/weekly/request";
import { weeklyWorkspace,validatedWeeklyDraft } from "../../lib/weekly/workspace";
import type { WeeklyView } from "../../lib/weekly/view";
import { tutorId } from "../fixtures/tutor-state";

type FixtureControl={view:WeeklyView;readStatus:number;writes:number;beforeRead:(route:Route)=>Promise<void>};
async function prepare(page:Page):Promise<FixtureControl>{
  const {context,proposal}=await weeklyPlanFixture();
  const state=weeklyWorkspace.parse({id:tutorId(1300),courseId:context.aggregate.courseId,date:"2026-10-25",version:1,context,fingerprint:"a".repeat(64),phase:"proposed",proposal,claims:[],notes:"저장된 메모",pendingKey:null,confirmedVersionId:null});
  const control:FixtureControl={view:{state,current:true,issue:null,versions:[],generationRecovery:{allowed:false,reason:"생성 중인 초안이 아니에요."}},readStatus:200,writes:0,beforeRead:async()=>{}};
  const script=await readFile(".sites-runtime/weekly-browser/fixture.iife.js","utf8");const css=await readFile(".sites-runtime/weekly-browser/fixture.css","utf8");
  await page.route("https://weekly.lifecycle.test/**",async route=>{
    const request=route.request();const path=new URL(request.url()).pathname;
    if(path==="/fixture.js"){await route.fulfill({contentType:"text/javascript; charset=utf-8",body:script});return;}
    if(path==="/fixture.css"){await route.fulfill({contentType:"text/css",body:css});return;}
    if(path==="/api/weekly"){
      if(request.method()==="POST"){control.writes++;await route.fulfill({status:409,json:{message:"예상하지 않은 저장이에요."}});return;}
      const snapshot=control.view;await control.beforeRead(route);
      await route.fulfill({status:control.readStatus,json:control.readStatus===200?snapshot:{message:"검증용 조회 실패"}});return;
    }
    if(path.startsWith("/api/"))throw new Error(`등록하지 않은 합성 API: ${path}`);
    await route.fulfill({contentType:"text/html; charset=utf-8",body:`<!doctype html><meta charset="utf-8"><main id="weekly-fixture"></main><script id="weekly-initial" type="application/json">${JSON.stringify(control.view).replaceAll("<","\\u003c")}</script><script src="/fixture.js"></script>`});
  });
  return control;
}
async function hide(page:Page):Promise<void>{await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pagehide")));await expect(page.getByText("로그인과 인출 상태를 서버에서 다시 확인하고 있어요. 작성 중인 입력은 보관돼요.",{exact:true})).toBeVisible();}
async function restore(page:Page):Promise<void>{await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pageshow")));}
async function inputs(page:Page):Promise<readonly string[]>{return page.locator(".weekly-workspace input,.weekly-workspace textarea,.weekly-workspace select").evaluateAll(elements=>elements.map(element=>{const input=element as HTMLInputElement;return JSON.stringify({name:input.name,value:input.value,checked:input.checked});}));}

test("모든 주간 입력은 가림·권한 오류·동일 버전 복귀에서 보존된다",async({page})=>{
  const control=await prepare(page);await page.goto("https://weekly.lifecycle.test/learn/weekly");
  await page.getByText("새 주간 점검",{exact:true}).click();await page.locator('input[name="date"]').fill("2026-10-26");await page.locator('input[name="time"]').fill("75");
  await page.locator('input[name="minutes"]').fill("80");await page.locator('input[name="availableMinutes"]').fill("");
  await page.locator('textarea[name="notes"]').fill("저장 전 메모");await page.locator('textarea[name="activity-0"]').fill("다음 주 직접 할 행동");await page.locator('input[name="minutes-0"]').fill("25");
  await page.locator('textarea[name="fact-0"]').fill("내가 수정한 설명");await page.locator('select[name="fact-status-0"]').selectOption("unverified");
  await page.locator('input[name="otherDomain"]').fill("비교 분야");for(const name of ["example","similarities","differences","limitations","uncertainty"])await page.locator(`textarea[name="${name}"]`).fill(`직접 작성한 ${name}`);
  await page.locator('input[name="keep-0"]').uncheck();const before=await inputs(page);
  await hide(page);await expect(page.locator("blockquote")).toHaveCount(0);await expect(page.locator(".weekly-workspace")).toBeHidden();
  control.readStatus=403;await restore(page);await expect(page.getByRole("alert")).toContainText("HTTP 403");await expect(page.locator(".weekly-workspace")).toBeHidden();expect(await inputs(page)).toEqual(before);
  control.readStatus=200;await page.getByRole("button",{name:"다시 확인",exact:true}).click();await expect(page.locator(".weekly-workspace")).toBeVisible();expect(await inputs(page)).toEqual(before);expect(control.writes).toBe(0);
  await expect(page.getByText("수정한 내용을 먼저 저장해 주세요.",{exact:true})).toBeVisible();expect(await page.pageErrors()).toEqual([]);
});

test("새 서버 버전과 가림 뒤 늦은 응답은 주간 초안을 덮어쓰거나 재노출하지 않는다",async({page})=>{
  const control=await prepare(page);await page.goto("https://weekly.lifecycle.test/learn/weekly");await page.locator('textarea[name="notes"]').fill("내 수정본");
  let release:()=>void=()=>{};let readStarted:()=>void=()=>{};const started=new Promise<void>(resolve=>{readStarted=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});control.beforeRead=async()=>{readStarted();await gate;};
  await hide(page);await restore(page);await started;await page.evaluate(()=>window.dispatchEvent(new Event("alter:recall-starting")));release();await expect(page.locator(".weekly-workspace")).toBeHidden();await expect(page.locator("blockquote")).toHaveCount(0);
  control.beforeRead=async()=>{};control.view={...control.view,state:{...control.view.state,version:2,notes:"다른 화면의 저장"}};
  await page.getByRole("button",{name:"다시 확인",exact:true}).click();await expect(page.getByRole("alert")).toContainText("새 주간 기록");await expect(page.locator('textarea[name="notes"]')).toHaveValue("내 수정본");await expect(page.getByRole("button",{name:"수정한 초안 저장",exact:true})).toBeDisabled();expect(control.writes).toBe(0);
  await page.getByRole("button",{name:"작성 중 입력 버리고 최신 기록 읽기",exact:true}).click();await expect(page.locator('textarea[name="notes"]')).toHaveValue("다른 화면의 저장");await expect(page.getByRole("button",{name:"수정한 초안 저장",exact:true})).toBeEnabled();expect(await page.pageErrors()).toEqual([]);
});

for(const workflowState of ["pending","conflict"] as const){
  test(`Google ${workflowState} 재조회 실패 뒤 같은 작업의 버튼을 다시 사용할 수 있다`,async({page})=>{
    const control=await prepare(page);control.view={...control.view,state:{...control.view.state,confirmedVersionId:tutorId(1396)}};
    let failReadback=false;let recover=false;const requests:unknown[]=[];
    const report={versionId:tutorId(1396),connected:true,workflow:{id:tutorId(1397),state:workflowState,operations:[{kind:"docs",state:"pending"}]},documentUrl:null,spreadsheetUrl:null};
    await page.route("**/api/google/reports*",async route=>{if(route.request().method()==="POST"){requests.push(route.request().postDataJSON());failReadback=true;await route.fulfill({status:recover?200:503,json:recover?{...report,connected:false}: {message:"시험 전송 실패"}});return;}await route.fulfill({status:failReadback&&!recover?503:200,json:failReadback&&!recover?{message:"시험 상태 조회 실패"}:report});});
    await page.route("**/api/external",async route=>{requests.push(route.request().postDataJSON());failReadback=true;await route.fulfill({status:recover?200:503,json:recover?{view:{state:"confirmed",operations:[{state:"confirmed"}]},disposition:"retained"}:{message:"시험 결과 조회 실패"}});});
    await page.goto("https://weekly.lifecycle.test/learn/weekly");const button=page.getByRole("button",{name:workflowState==="pending"?"Google 내보내기 이어서 진행":"Google 결과 다시 확인",exact:true});await button.click();await expect(page.getByRole("status").filter({hasText:"상태 재조회를 마치지 못했어요"})).toBeVisible();await expect(button).toBeEnabled();expect(await page.pageErrors()).toEqual([]);
    recover=true;await button.click();await expect(button).toBeEnabled();expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(await page.pageErrors()).toEqual([]);
  });
}

test("끝난 AI 실패만 현재 근거로 초안을 다시 열고 생성 요청은 보내지 않는다",async({page})=>{
  const control=await prepare(page);control.view={...control.view,current:false,state:{...control.view.state,phase:"generating",pendingKey:"failed-generation",proposal:null},generationRecovery:{allowed:true,reason:"AI 응답 검증 실패가 확정되어 초안을 다시 열 수 있어요."}};
  const actions:unknown[]=[];await page.route("**/api/weekly",async route=>{
    if(route.request().method()!=="POST"){await route.fallback();return;}
    const action:unknown=route.request().postDataJSON();actions.push(action);expect(action).toEqual({action:"reset-generation",id:tutorId(1300),expectedVersion:1});
    control.view={...control.view,current:true,state:{...control.view.state,phase:"draft",pendingKey:null,version:2},generationRecovery:{allowed:false,reason:"생성 중인 초안이 아니에요."}};await route.fulfill({json:control.view});
  });
  await page.goto("https://weekly.lifecycle.test/learn/weekly");const reset=page.getByRole("button",{name:"AI 제안 비우고 초안 다시 열기",exact:true});await expect(reset).toBeEnabled();await reset.click();await expect(reset).toHaveCount(0);await expect(page.getByRole("button",{name:"주간 요약·다음 주 제안 생성",exact:true})).toBeEnabled();expect(actions).toHaveLength(1);expect(await page.pageErrors()).toEqual([]);
});


test("편집 초안과 별도 시간은 순서대로 저장하고 새 점검 입력은 유지한다",async({page})=>{
  const control=await prepare(page);const actions:string[]=[];
  await page.route("**/api/weekly",async route=>{
    if(route.request().method()!=="POST"){await route.fallback();return;}
    const input=weeklyAction.parse(route.request().postDataJSON());actions.push(input.action);
    if(input.action==="save")control.view={...control.view,state:validatedWeeklyDraft(control.view.state,input.input)};
    else if(input.action==="time")control.view={...control.view,state:{...control.view.state,version:control.view.state.version+1,context:{...control.view.state.context,availableMinutes:input.availableMinutes}}};
    else throw new Error("허용하지 않은 합성 저장");
    await route.fulfill({json:control.view});
  });
  await page.goto("https://weekly.lifecycle.test/learn/weekly");await page.getByText("새 주간 점검",{exact:true}).click();await page.locator('input[name="date"]').fill("2026-10-26");await page.locator('input[name="time"]').fill("65");await page.locator('input[name="minutes"]').fill("75");await page.locator('textarea[name="notes"]').fill("따로 보관한 편집 메모");
  await page.getByRole("button",{name:"수정한 초안 저장",exact:true}).click();await expect(page.getByText(/기록 2판/)).toBeVisible();await expect(page.locator('input[name="minutes"]')).toHaveValue("75");await expect(page.locator('input[name="time"]')).toHaveValue("65");
  await page.getByRole("button",{name:"시간 저장",exact:true}).click();await expect(page.getByText(/기록 3판/)).toBeVisible();await expect(page.locator('input[name="minutes"]')).toHaveValue("75");await expect(page.locator('textarea[name="notes"]')).toHaveValue("따로 보관한 편집 메모");await expect(page.locator('input[name="time"]')).toHaveValue("65");expect(actions).toEqual(["save","time"]);expect(await page.pageErrors()).toEqual([]);
});
