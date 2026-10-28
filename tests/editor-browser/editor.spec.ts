import { pngImage } from "../fixtures/png-bytes";
import { checkAccessibility } from "../fixtures/accessibility";
import { readFile } from "node:fs/promises";
import { expect,test } from "@playwright/test";
import { editorWaitingFixture } from "../fixtures/editor-state";
import { tutorId } from "../fixtures/tutor-state";
import { publicEditorView } from "../../lib/editor/view";
import { editorAction } from "../../lib/editor/actions";
import { saveEditorRevisionDraft,submitEditorRevision } from "../../lib/editor/revision";

test("수정본과 이유 필수·자동 저장 실패 보존·새로고침 복원",async ({page},info)=>{
  test.setTimeout(45000);
  let state=editorWaitingFixture();let failDraft=false;let lostSubmit=false;let posts=0;let photoRequests=0;
  const script=await readFile(".sites-runtime/editor-browser/fixture.iife.js","utf8");const css=await readFile(".sites-runtime/editor-browser/fixture.css","utf8");
  await page.route("https://editor.local.test/**",async (route)=>{
    const url=new URL(route.request().url());if(url.pathname==="/fixture.js"){await route.fulfill({contentType:"text/javascript; charset=utf-8",body:script});return;}if(url.pathname==="/fixture.css"){await route.fulfill({contentType:"text/css",body:css});return;}
    if(url.pathname.startsWith("/api/materials/")){photoRequests+=1;await route.fulfill({status:503,json:{error:"unexpected-photo-request"}});return;}
    if(url.pathname==="/api/editor"){
      if(route.request().method()==="GET"){await route.fulfill({json:publicEditorView(state)});return;}
      posts+=1;const input=editorAction.parse(route.request().postDataJSON());if("expectedVersion" in input && input.expectedVersion!==state.version){await route.fulfill({status:409,json:{error:"version_conflict",message:"최신 기록 확인 필요"}});return;}
      if(input.action==="revision-draft"){if(failDraft){failDraft=false;await route.fulfill({status:503,json:{error:"storage_failure",message:"검사용 저장 장애"}});return;}state=saveEditorRevisionDraft(state,input.draft,input.reason);}
      else if(input.action==="revision-submit"){state=submitEditorRevision(state,{answerId:input.answerId,attemptId:input.attemptId,draft:input.draft,reason:input.reason,submittedAt:Date.now()});if(lostSubmit){lostSubmit=false;await route.abort("failed");return;}}
      else throw new Error(`예상하지 않은 요청 ${input.action}`);
      await route.fulfill({json:publicEditorView(state)});return;
    }
    const overview={history:[{id:state.id,version:state.version,title:state.start.bundle.unit.title,phase:state.phase}],scopes:[{id:tutorId(1),title:"분수",date:"2026-10-24"}]};const data=JSON.stringify({overview,view:publicEditorView(state)}).replaceAll("<","\u003c");
    await route.fulfill({contentType:"text/html; charset=utf-8",body:`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><main id="editor-fixture"></main><script id="editor-initial" type="application/json">${data}</script><script src="/fixture.js"></script></body></html>`});
  });
  await page.goto("https://editor.local.test/");await expect(page.getByLabel("나의 수정본",{exact:true})).toHaveValue("1/4은 네 조각");await expect(page.getByRole("button",{name:"수정본과 이유 제출·저장",exact:true})).toBeDisabled();
  expect(await page.locator("body").innerText()).not.toContain(state.start.bundle.sources[0].evidence);
await checkAccessibility(page,".editor-panel",info);
  state=saveEditorRevisionDraft(state,{text:"휴대폰에서 저장한 수정본",fileIds:[tutorId(102)]},"휴대폰에서 저장한 이유");
  const cleanRefreshPosts=posts;await page.getByRole("button",{name:"최신 개선 기록 확인",exact:true}).click();
  await expect(page.getByLabel("나의 수정본",{exact:true})).toHaveValue("휴대폰에서 저장한 수정본");await expect(page.getByRole("textbox",{name:"수정 이유",exact:true})).toHaveValue("휴대폰에서 저장한 이유");await expect(page.getByText("첨부: 사진 1",{exact:true})).toBeVisible();
  await page.waitForTimeout(1200);expect(posts).toBe(cleanRefreshPosts);expect(state.draft.fileIds).toEqual([tutorId(102)]);
  failDraft=true;await page.getByRole("textbox",{name:"수정 이유",exact:true}).fill("현재 탭의 미저장 수정 이유");await expect(page.getByRole("alert")).toContainText("검사용 저장 장애");
  state=saveEditorRevisionDraft(state,{text:"다른 기기의 최신 수정본",fileIds:[]},"다른 기기의 최신 이유");const conflictPosts=posts;
  for(let attempt=0;attempt<2;attempt+=1){await page.getByRole("button",{name:"최신 개선 기록 확인",exact:true}).click();await expect(page.getByRole("alert")).toContainText("다른 화면에서 초안이 변경");await expect(page.getByRole("textbox",{name:"수정 이유",exact:true})).toHaveValue("현재 탭의 미저장 수정 이유");await page.waitForTimeout(1200);expect(posts).toBe(conflictPosts);expect(state.editor?.draftReason).toBe("다른 기기의 최신 이유");}
  await page.getByRole("link",{name:"오늘의 학습 현황",exact:true}).click();await expect(page).toHaveURL("https://editor.local.test/");expect(posts).toBe(conflictPosts);
  const photo={name:"answer.png",mimeType:"image/png",buffer:Buffer.from(pngImage({width:1,height:1,depth:8,color:2,interlace:0},new Uint8Array([0,20,40,60])))};
  await expect(page.locator('input[type="file"]')).toBeDisabled();await page.locator('input[type="file"]').setInputFiles(photo);await expect(page.getByRole("alert")).toContainText("저장·사진 전송 결과");expect(photoRequests).toBe(0);expect(posts).toBe(conflictPosts);
  await page.getByRole("button",{name:"같은 저장 요청 다시 확인",exact:true}).click();await expect(page.getByRole("alert")).toContainText("최신 기록 확인 필요");
  await page.getByRole("textbox",{name:"수정 이유",exact:true}).fill("검토하고 선택한 수정 이유");await expect(page.getByRole("status")).toContainText("서버 초안 저장을 확인했어요");expect(state.draft.text).toBe("휴대폰에서 저장한 수정본");expect(state.editor?.draftReason).toBe("검토하고 선택한 수정 이유");

  failDraft=true;await page.getByLabel("나의 수정본",{exact:true}).fill("같은 크기 네 조각 중 한 조각");await expect(page.getByRole("alert")).toContainText("검사용 저장 장애");const failedPosts=posts;await page.waitForTimeout(1200);expect(posts).toBe(failedPosts);await expect(page.getByLabel("나의 수정본",{exact:true})).toHaveValue("같은 크기 네 조각 중 한 조각");
  await page.getByRole("button",{name:"같은 저장 요청 다시 확인",exact:true}).click();await expect(page.locator("#editor-draft-status")).toContainText("서버 초안 저장을 확인했어요");
  await page.getByRole("textbox",{name:"수정 이유",exact:true}).fill("전체와 선택 부분을 구분했다");await expect(page.getByRole("status")).toContainText("서버 초안 저장을 확인했어요");await page.reload();await expect(page.getByRole("textbox",{name:"수정 이유",exact:true})).toHaveValue("전체와 선택 부분을 구분했다");await expect(page.getByLabel("나의 수정본",{exact:true})).toHaveValue("같은 크기 네 조각 중 한 조각");
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pagehide")));await expect(page.getByLabel("나의 수정본",{exact:true})).toHaveCount(0);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pageshow")));await expect(page.getByLabel("나의 수정본",{exact:true})).toBeVisible();
  lostSubmit=true;await page.getByRole("button",{name:"수정본과 이유 제출·저장",exact:true}).click();await expect(page.getByRole("alert")).toBeVisible();await page.getByRole("button",{name:"최신 개선 기록 확인",exact:true}).click();await expect(page.getByText("수정본과 이유를 저장했어요. 원본과 피드백은 그대로 보관해요.",{exact:true})).toBeVisible();expect(state.editor?.versions).toHaveLength(2);expect(state.pending).toBeNull();
  const beforeGuidance=posts;
  await page.evaluate(()=>{window.location.hash="check-editor-saved";});
  await expect(page.locator("#check-editor-saved")).toBeFocused();
  await expect(page.locator("#check-editor-saved details")).toHaveAttribute("open","");
  await expect(page.getByRole("link",{name:"← 두 가지 확인 화면으로",exact:true})).toHaveAttribute("href","/learn#check-navigation");
  expect(posts).toBe(beforeGuidance);
  await page.screenshot({path:`outputs/editor-check-${info.project.name}.png`,fullPage:true});
await expect(page.getByText("수정 이유: 전체와 선택 부분을 구분했다",{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.pageErrors()).toEqual([]);await page.screenshot({path:`outputs/editor-${info.project.name}.png`,fullPage:true});
});
