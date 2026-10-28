import { expect, test } from "@playwright/test";
import { mountTutorInput } from "../fixtures/tutor-input-browser";
import { tutorHelpBrowserFixture } from "../fixtures/tutor-help-browser";
import { publicTutorView } from "../../lib/tutor/view";
import { checkAccessibility } from "../fixtures/accessibility";

test("원본 열기·AI 도움 이력을 구분하고 조회 실패를 무도움 수행으로 바꾸지 않는다", async ({ page }, info) => {
  const state = tutorHelpBrowserFixture(2);
  const fixture = await mountTutorInput(page, state);
  const original = page.getByRole("region", { name: "원본 열기 기록", exact: true });
  await expect(original).toContainText("아직 확인되지 않았어요");
  let failed: boolean = false; let writes: number = 0;
  await page.route("**/api/tutor*", async (route): Promise<void> => {
    if (route.request().method() !== "GET") { writes++; throw new Error("이력 확인 중 쓰기 요청이 발생했습니다."); }
    if (failed) { await route.fulfill({ status:503,json:{error:"storage_failure",message:"원본 열기 기록 조회 중단"} }); return; }
    await route.fulfill({ json:{...publicTutorView(state),originalExposure:{currentQuestionCount:1,sessionCount:2}} });
  });
  await page.getByRole("button", { name:"최신 수업 기록 확인",exact:true }).click();
  await expect(original).toContainText("현재 질문 1개 · 이 회차 2개 기록");
  await expect(page.getByRole("region", { name:"도움 단계와 사용 기록",exact:true })).toContainText("현재 질문 2단계");
  await page.evaluate(():void=>{window.dispatchEvent(new PageTransitionEvent("pagehide"));});
  failed=true; await page.evaluate(():void=>{window.dispatchEvent(new PageTransitionEvent("pageshow"));});
  await expect(page.getByRole("alert")).toContainText("원본 열기 기록 조회 중단");
  await expect(original).toHaveCount(0); await expect(page.getByRole("region",{name:"현재 수업",exact:true})).toHaveCount(0);
  failed=false; await page.getByRole("button",{name:"최신 수업 기록 확인",exact:true}).click();
  await expect(original).toContainText("현재 질문 1개 · 이 회차 2개 기록");
  await expect(page.locator("blockquote")).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(state.start.bundle.sources[0].evidence);
  expect(fixture.actions).toEqual([]); expect(writes).toBe(0);
  await checkAccessibility(page,".tutor-panel",info);
  await page.screenshot({path:`outputs/ui-help/exposure-n5-${info.project.name}.png`,fullPage:true});
});
