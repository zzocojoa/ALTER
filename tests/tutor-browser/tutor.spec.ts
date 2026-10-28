import { confirmTutorAiTransmission } from "../fixtures/tutor-ai-consent";
import { fixtureTutorBudget } from "../fixtures/tutor-budget";
import { checkAccessibility } from "../fixtures/accessibility";
import { pngImage } from "../fixtures/png-bytes";
import { readFile } from "node:fs/promises";
import { expect,test } from "@playwright/test";
import { tutorStateFixture,tutorLessonFixture,tutorDiagnosisFixture,tutorId } from "../fixtures/tutor-state";
import { beginTutorLesson,finishTutorLesson,beginTutorRecall,saveTutorDraft,saveTutorAnswer,beginTutorDiagnosis,finishTutorDiagnosis,pauseTutor,resumeTutor } from "../../lib/tutor/state";
import { publicTutorView } from "../../lib/tutor/view";
import { tutorAction } from "../../lib/tutor/request";
import { tutorAnswer } from "../../lib/tutor/contracts";

/** 실제 React 수업 화면을 실행하고 네트워크 저장소·AI는 명시적인 대역으로 제공합니다. */
test("인출 비노출·자동 저장·실패 입력 보존·새로고침·중단 재개",async ({page},info)=>{
  let state=finishTutorLesson(beginTutorLesson(tutorStateFixture()),tutorLessonFixture());let failDraft=false;let lostSubmit=false;let posts=0;let photoWorks=false;let uploadedBodies=0;let photoRegistered=false;const photoKeys:string[]=[];const writes:Readonly<{body:string;key:string}>[]=[];
  const script=await readFile(".sites-runtime/tutor-browser/fixture.iife.js","utf8");const css=await readFile(".sites-runtime/tutor-browser/fixture.css","utf8");
  await page.route("https://tutor.local.test/**",async (route)=>{
    const url=new URL(route.request().url());
    if (url.pathname === "/api/dashboard/usage") { await route.fulfill({ json: fixtureTutorBudget(Date.now()) }); return; }
    if(url.pathname==="/fixture.js"){await route.fulfill({contentType:"text/javascript; charset=utf-8",body:script});return;}
    if(url.pathname==="/fixture.css"){await route.fulfill({contentType:"text/css",body:css});return;}
    if(url.pathname==="/api/materials/uploads"){photoKeys.push(route.request().headers()["idempotency-key"]);if(!photoWorks){await route.fulfill({status:503,json:{error:"photo-test-unavailable"}});return;}await route.fulfill({json:{id:tutorId(101),materialId:tutorId(102),version:1,state:photoRegistered?"registered":"reserved"}});return;}
    if(url.pathname.startsWith(`/api/materials/uploads/${tutorId(101)}`)){
      if(url.pathname.endsWith("/body")){uploadedBodies++;await route.fulfill({json:{id:tutorId(101),materialId:tutorId(102),version:2,state:"stored"}});return;}
      if(url.pathname.endsWith("/complete")) photoRegistered=true;
      await route.fulfill({json:{id:tutorId(101),materialId:tutorId(102),version:photoRegistered?3:1,state:photoRegistered?"registered":"reserved"}});return;
    }
    if(url.pathname==="/api/tutor"){
      if(route.request().method()==="GET"){await route.fulfill({json:publicTutorView(state)});return;}
      posts+=1;writes.push({body:route.request().postData() ?? "",key:route.request().headers()["idempotency-key"]});const input=tutorAction.parse(route.request().postDataJSON());
      if("expectedVersion" in input && input.expectedVersion!==state.version){await route.fulfill({status:409,json:{error:"version_conflict",message:"최신 기록 확인 필요"}});return;}
      switch(input.action){
        case "recall":state=beginTutorRecall(state);break;
        case "draft":if(failDraft){failDraft=false;await route.fulfill({status:503,json:{error:"storage_failure",message:"검사용 저장 장애"}});return;}state=saveTutorDraft(state,input.draft);break;
        case "submit":state=saveTutorAnswer({...state,draft:input.draft},tutorAnswer.parse({id:input.answerId,attemptId:state.question.attemptId,questionId:state.question.id,...input.draft,helped:false,submittedAt:Date.now()}));if(lostSubmit){lostSubmit=false;await route.abort("failed");return;}break;
        case "pause":state=pauseTutor(state);break;case "resume":state=resumeTutor(state);break;
        case "diagnose":state=finishTutorDiagnosis(beginTutorDiagnosis(state),{...tutorDiagnosisFixture(),questionId:state.question.id,answerId:state.currentAnswerId!});break;
        default:throw new Error(`예상하지 않은 요청 ${input.action}`);
      }
      await route.fulfill({json:publicTutorView(state)});return;
    }
    const overview={history:[{id:state.id,version:state.version,title:state.start.bundle.unit.title,phase:state.phase}],scopes:[{id:tutorId(1),title:"분수",date:"2026-10-24"}]};const data=JSON.stringify({overview,view:publicTutorView(state)}).replaceAll("<","\u003c");
    await route.fulfill({contentType:"text/html; charset=utf-8",body:`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><main id="tutor-fixture"></main><script id="tutor-initial" type="application/json">${data}</script><script src="/fixture.js"></script></body></html>`});
  });
  await page.goto("https://tutor.local.test/");await expect.poll(async()=>page.locator("#tutor-fixture").innerHTML()).not.toBe("");await expect(page.getByText(tutorLessonFixture().explanation.text,{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"자료와 설명 가리고 시작",exact:true}).click();await expect(page.getByTestId("tutor-question")).toHaveCount(1);await expect(page.getByText(tutorLessonFixture().explanation.text,{exact:true})).toHaveCount(0);await expect(page.locator("blockquote")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"답안 제출·저장",exact:true})).toBeDisabled();
  state=saveTutorDraft(state,{text:"다른 기기에서 저장한 휴대폰 답안",fileIds:[tutorId(102)]});
  const beforeRemoteRefresh=posts;await page.getByRole("button",{name:"최신 수업 기록 확인",exact:true}).click();
  await expect(page.getByLabel("나의 답안",{exact:true})).toHaveValue("다른 기기에서 저장한 휴대폰 답안");await expect(page.getByText("첨부: 풀이 사진 1",{exact:true})).toBeVisible();await page.waitForTimeout(1200);expect(posts).toBe(beforeRemoteRefresh);expect(state.draft.text).toBe("다른 기기에서 저장한 휴대폰 답안");
  state=saveTutorDraft(state,{text:"",fileIds:[]});await page.getByRole("button",{name:"최신 수업 기록 확인",exact:true}).click();await expect(page.getByLabel("나의 답안",{exact:true})).toHaveValue("");
  await checkAccessibility(page,".tutor-panel",info);
  const photo={name:"answer.png",mimeType:"image/png",buffer:Buffer.from(pngImage({width:1,height:1,depth:8,color:2,interlace:0},new Uint8Array([0,20,40,60])))};
  await page.locator('input[type="file"]').setInputFiles(photo);await expect(page.getByRole("alert")).toContainText("photo-test-unavailable");
  await page.reload();await page.locator('input[type="file"]').setInputFiles(photo);await expect(page.getByRole("alert")).toContainText("photo-test-unavailable");
  await page.locator('input[type="file"]').setInputFiles(photo);await expect.poll(()=>photoKeys.length).toBe(3);expect(new Set(photoKeys).size).toBe(1);await expect(page.locator('input[type="file"]')).toBeEnabled();
  failDraft=true;await page.getByLabel("나의 답안",{exact:true}).fill("보존할 답안");await page.getByRole("link",{name:"오늘의 학습 현황",exact:true}).click();await expect(page).toHaveURL("https://tutor.local.test/");await expect(page.getByRole("alert")).toContainText("검사용 저장 장애");await expect(page.getByLabel("나의 답안",{exact:true})).toHaveValue("보존할 답안");const failedPosts=posts;const failedWrite=writes.at(-1);await page.waitForTimeout(1200);expect(posts).toBe(failedPosts);
  await page.getByRole("button",{name:"최신 수업 기록 확인",exact:true}).click();await expect(page.getByText("저장 결과가 아직 확인되지 않았어요",{exact:true})).toBeVisible();await page.getByRole("button",{name:"같은 저장 요청 다시 확인",exact:true}).click();await expect(page.getByText("서버 초안 저장을 확인했어요",{exact:true})).toBeVisible();expect(writes.at(-1)).toEqual(failedWrite);
  failDraft=true;await page.getByLabel("나의 답안",{exact:true}).fill("이 탭의 미저장 입력");await expect(page.getByRole("alert")).toContainText("검사용 저장 장애");
  state=saveTutorDraft(state,{text:"다른 기기의 새 초안",fileIds:[]});const beforeConflictingRefresh=posts;await page.getByRole("button",{name:"최신 수업 기록 확인",exact:true}).click();await expect(page.getByRole("alert")).toContainText("다른 화면에서 초안이 변경");await expect(page.getByLabel("나의 답안",{exact:true})).toHaveValue("이 탭의 미저장 입력");await page.waitForTimeout(1200);expect(posts).toBe(beforeConflictingRefresh);expect(state.draft.text).toBe("다른 기기의 새 초안");
  await page.getByRole("button",{name:"최신 수업 기록 확인",exact:true}).click();await expect(page.getByRole("alert")).toContainText("다른 화면에서 초안이 변경");await page.waitForTimeout(1200);expect(posts).toBe(beforeConflictingRefresh);expect(state.draft.text).toBe("다른 기기의 새 초안");
  await page.getByRole("link",{name:"오늘의 학습 현황",exact:true}).click();await expect(page).toHaveURL("https://tutor.local.test/");expect(posts).toBe(beforeConflictingRefresh);expect(state.draft.text).toBe("다른 기기의 새 초안");
  await expect(page.getByRole("button",{name:"잠시 멈추기",exact:true})).toBeDisabled();await expect(page.getByLabel("나의 답안",{exact:true})).toHaveValue("이 탭의 미저장 입력");expect(posts).toBe(beforeConflictingRefresh);expect(state.phase).toBe("awaiting-answer");
  const conflictedPhotoRequests=photoKeys.length;await expect(page.locator('input[type="file"]')).toBeDisabled();expect(photoKeys.length).toBe(conflictedPhotoRequests);expect(posts).toBe(beforeConflictingRefresh);
  await page.getByRole("button",{name:"같은 저장 요청 다시 확인",exact:true}).click();await expect(page.getByRole("alert")).toContainText("최신 기록");
  await page.getByLabel("나의 답안",{exact:true}).fill("보존할 답안");await expect(page.getByText("서버 초안 저장을 확인했어요",{exact:true})).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pagehide")));await expect(page.getByTestId("tutor-question")).toHaveCount(0);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pageshow")));await expect(page.getByTestId("tutor-question")).toHaveCount(1);
  await page.reload();await expect(page.getByLabel("나의 답안",{exact:true})).toHaveValue("보존할 답안");await expect(page.locator("blockquote")).toHaveCount(0);
  await page.getByLabel("나의 답안",{exact:true}).fill("멈추기 직전 답안");await page.getByRole("button",{name:"잠시 멈추기",exact:true}).click();await expect(page.getByLabel("나의 답안",{exact:true})).toHaveCount(0);await page.reload();await page.getByRole("button",{name:"수업 이어가기",exact:true}).click();await expect(page.getByLabel("나의 답안",{exact:true})).toHaveValue("멈추기 직전 답안");
  const beforeCancel=photoKeys.length;await page.locator('input[type="file"]').setInputFiles([]);expect(photoKeys.length).toBe(beforeCancel);
  photoWorks=true;failDraft=true;await page.locator('input[type="file"]').setInputFiles(photo);await expect(page.getByRole("status",{name:"사진 전송 상태"})).toContainText("사진은 등록됐지만 답안 저장이 확인되지 않았어요");const photoFailedPosts=posts;await page.waitForTimeout(1200);expect(posts).toBe(photoFailedPosts);expect(state.draft.fileIds).toEqual([]);await page.getByRole("button",{name:"같은 저장 요청 다시 확인",exact:true}).click();await expect(page.getByRole("status",{name:"사진 전송 상태"})).toHaveText("사진 첨부와 초안 저장이 완료됐어요.");await expect(page.getByText("첨부: 풀이 사진 1",{exact:true})).toBeVisible();
  expect(uploadedBodies).toBe(1);expect(state.draft.fileIds).toEqual([tutorId(102)]);
  await page.getByLabel("나의 답안",{exact:true}).fill("이동 직전 저장할 답안");await page.getByRole("link",{name:"오늘의 학습 현황",exact:true}).click();await expect(page).toHaveURL("https://tutor.local.test/learn");expect(state.draft.text).toBe("이동 직전 저장할 답안");await page.goBack();await expect(page.getByLabel("나의 답안",{exact:true})).toHaveValue("이동 직전 저장할 답안");await expect(page.getByText("첨부: 풀이 사진 1",{exact:true})).toBeVisible();
  lostSubmit=true;await page.getByRole("button",{name:"답안 제출·저장",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await page.getByRole("button",{name:"최신 수업 기록 확인",exact:true}).click();await expect(page.getByRole("heading",{name:"제출한 답안",exact:true})).toHaveCount(1);expect(state.answers).toHaveLength(1);expect(state.diagnosis).toBeNull();
  await confirmTutorAiTransmission(page,"저장한 답안 진단");await page.getByRole("button",{name:"저장한 답안 진단",exact:true}).click();await expect(page.getByText(tutorDiagnosisFixture().observation,{exact:true})).toBeVisible();await expect(page.locator("blockquote")).toHaveCount(0);expect(await page.locator("body").innerText()).not.toContain(tutorDiagnosisFixture().citations[0].quote);expect(state.diagnosis?.citations).toEqual(tutorDiagnosisFixture().citations);
  state={...state,diagnosis:{...tutorDiagnosisFixture(),needsHelp:true}};await page.getByRole("button",{name:"최신 수업 기록 확인",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("서로 맞지 않아요");await expect(page.getByRole("button",{name:"새 조건 과제 요청",exact:true})).toBeDisabled();await expect(page.getByRole("button",{name:"다음 단계 도움 요청",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"답안 다시 쓰기",exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.pageErrors()).toEqual([]);await page.screenshot({path:`outputs/tutor-${info.project.name}.png`,fullPage:true});
});
