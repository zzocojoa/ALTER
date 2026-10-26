import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { LIBRARIAN_ACCEPTANCE_ID, STUDY_ACCEPTANCE_TEXT } from "../../lib/librarian/acceptance-fixture";
import { beginScopeEvaluation, finishScopeEvaluation, confirmStudyScope } from "../../lib/librarian/state";
import { librarianOutputFixture } from "../fixtures/librarian-output";
import { scopeViewReply } from "../../app/learn/library/client-api";
import { librarianAction } from "../../lib/librarian/request";

test("범위 API는 미인증·교차 출처·다른 소유자 참조를 거부한다", async ({ page,request }) => {
  for (const route of ["/api/librarian","/api/librarian/sources","/api/librarian/acceptance",`/api/librarian/sources/${randomUUID()}/visibility`]) expect((await request.get(route)).status()).toBe(401);
  await page.goto("/signin-with-chatgpt?return_to=/learn/library");
  expect((await page.request.post("/api/librarian",{ headers: { origin: "https://evil.test" },data: {} })).status()).toBe(403);
  expect((await page.request.get(`/api/librarian?id=${randomUUID()}`)).status()).toBe(409);
  expect((await page.request.get(`/api/librarian/sources?materialId=${randomUUID()}`)).status()).toBe(404);
});

/** 원본 준비·텍스트 이동은 실제 로컬 API, AI 비교와 확정 화면은 모의 응답으로 구분합니다. */
test("자료 준비·정확한 텍스트 이동·비교·시간·명시적 확정 화면", async ({ page },info) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/library");
  await expect(page.locator(".storage-check button").first()).toBeEnabled();
  await page.getByText("Task 8 고정 자료 검증",{ exact: true }).click();
  await page.getByRole("button",{ name: "시험 자료 준비·저장 상태 확인",exact: true }).click();
  await expect(page.getByText(/시험 범위 기록 .*판/)).toBeVisible({ timeout: 30000 });
  const raw = await page.request.get(`/api/librarian?id=${LIBRARIAN_ACCEPTANCE_ID}`); expect(raw.status()).toBe(200);
  let view = scopeViewReply.parse(await raw.json()); expect(view.scope.phase).toBe("linked");
  const source = view.scope.candidates[0].sources[0]; expect(source.evidence).toBe(STUDY_ACCEPTANCE_TEXT);
  const original = await page.context().newPage(); await original.goto(`/learn/source/${source.id}`);
  await expect(original.getByLabel("텍스트 원본")).toHaveText(STUDY_ACCEPTANCE_TEXT);
  await expect(original.getByRole("blockquote")).toHaveText(STUDY_ACCEPTANCE_TEXT);
  await original.getByText("전체 추출 결과에서 위치 확인",{ exact: true }).click(); await expect(original.locator("mark")).toHaveText(STUDY_ACCEPTANCE_TEXT);
  expect((await original.request.get(`/api/librarian/sources/${source.id}/visibility`)).status()).toBe(200);
  expect((await original.request.get(`/api/librarian/sources/${randomUUID()}/visibility`)).status()).toBe(409);
  await original.route(`**/api/librarian/sources/${source.id}/visibility`,route=>route.fulfill({status:403,json:{valid:false}}));
  await original.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pagehide")));await expect(original.getByRole("blockquote")).toHaveCount(0);
  await original.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pageshow")));await expect(original.getByRole("alert")).toContainText("HTTP 403");await expect(original.getByLabel("텍스트 원본")).toHaveCount(0);
  await original.unroute(`**/api/librarian/sources/${source.id}/visibility`);await original.getByRole("button",{name:"원문 접근 다시 확인"}).click();await expect(original.getByRole("blockquote")).toHaveText(STUDY_ACCEPTANCE_TEXT);
  expect(await original.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await original.pageErrors()).toEqual([]); await original.close();
  let stale: boolean = false;
  await page.route("**/api/librarian",async (route): Promise<void> => {
    const input = librarianAction.parse(route.request().postDataJSON());
    if (stale) { stale=false; await route.fulfill({ status: 409,json: { error: "version_conflict",message: "최신 기록을 다시 확인해 주세요." } }); return; }
    if (input.action === "generate") { const pending=beginScopeEvaluation(view.scope); view={ ...view,scope: finishScopeEvaluation(pending,librarianOutputFixture(pending)) }; }
    if (input.action === "confirm") view={ ...view,scope: confirmStudyScope(view.scope) };
    await route.fulfill({ json: view });
  });
  await page.route(`**/api/librarian?id=${LIBRARIAN_ACCEPTANCE_ID}`,async (route): Promise<void> => { await route.fulfill({ json: view }); });
  await page.reload();
  await page.getByRole("button",{ name: "선택 자료를 AI로 비교하고 범위 제안받기",exact: true }).click();
  await expect(page.getByText("읽기·질문·직접 수행 총 20분",{ exact: true })).toBeVisible();
  await expect(page.getByRole("button",{ name: "오늘의 학습 범위 확정",exact: true })).toBeDisabled();
  await expect(page.getByRole("heading",{ name: "Tutor에 전달할 학습 묶음",exact: true })).toBeVisible();
  await page.getByRole("checkbox",{ name: /판의 원문·선정 근거/ }).check(); stale=true;
  await page.getByRole("button",{ name: "오늘의 학습 범위 확정",exact: true }).click(); await expect(page.getByRole("alert")).toContainText("최신 기록");
  await page.getByRole("button",{ name: "최신 범위 확인",exact: true }).click(); await page.getByRole("checkbox",{ name: /판의 원문·선정 근거/ }).check();
  await page.getByRole("button",{ name: "오늘의 학습 범위 확정",exact: true }).click();
  await expect(page.getByText("검토한 학습 범위를 저장했어요.",{ exact: false })).toBeVisible();
  await page.getByLabel("오늘의 학습 수준·가정 (선택)",{exact:true}).fill("가려도 보관할 범위 입력");
  let denied:boolean=false;let delayRead:boolean=true;let releaseRead:()=>void=()=>{};let notifyRead:()=>void=()=>{};
  const readStarted=new Promise<void>(resolve=>{notifyRead=resolve;});const readGate=new Promise<void>(resolve=>{releaseRead=resolve;});
  await page.route(`**/api/librarian?id=${LIBRARIAN_ACCEPTANCE_ID}`,async route=>{
    if(delayRead){notifyRead();await readGate;}
    await route.fulfill({status:denied?403:200,json:denied?{error:"material-hidden-during-recall",message:"인출 중 원문 가림"}:view});
  });
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pagehide")));await expect(page.locator(".library-bundle")).toHaveCount(0);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent("pageshow")));await readStarted;
  await page.evaluate(()=>window.dispatchEvent(new Event("alter:recall-starting")));releaseRead();await expect(page.locator(".library-content")).toBeHidden();await expect(page.locator(".library-bundle")).toHaveCount(0);
  delayRead=false;denied=true;await page.getByRole("button",{name:"자료 접근 다시 확인",exact:true}).click();await expect(page.getByRole("alert")).toContainText("HTTP 403");await expect(page.locator(".library-bundle")).toHaveCount(0);
  denied=false;await page.getByRole("button",{name:"자료 접근 다시 확인",exact:true}).click();await expect(page.locator(".library-bundle blockquote")).toHaveText(STUDY_ACCEPTANCE_TEXT);await expect(page.getByLabel("오늘의 학습 수준·가정 (선택)",{exact:true})).toHaveValue("가려도 보관할 범위 입력");
  await page.screenshot({ path: `outputs/librarian-${info.project.name}.png`,fullPage: true });
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(await page.pageErrors()).toEqual([]);
});
