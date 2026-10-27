import { expect, test } from "@playwright/test";
import type { UsageDashboard } from "../../lib/dashboard/usage";
import { beginDirectTutorAnswer, saveTutorAnswer } from "../../lib/tutor/state";
import { tutorStateFixture, tutorAnswerFixture } from "../fixtures/tutor-state";
import { mountTutorInput } from "../fixtures/tutor-input-browser";
import { fixtureTutorBudget } from "../fixtures/tutor-budget";
import { confirmTutorAiTransmission } from "../fixtures/tutor-ai-consent";

const submitted = saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()), tutorAnswerFixture());
/** 승인은 대역이며 실제 계정 원장이나 지출 상태를 변경하지 않습니다. */
function probeBudget(now: number, committed: number): UsageDashboard {
  const data = fixtureTutorBudget(now);
  if (!data.ai.funding) throw new Error("비용 검사에 자금 대역이 필요합니다.");
  return { ...data,ai:{...data.ai,probeCommittedUsdMicros:committed,funding:{...data.ai.funding,probeLimitUsdMicros:300_000}} };
}

for (const failure of ["상한", "오래된 원장", "조회 실패", "지원 만료"] as const) test(`동의 이후 ${failure}: 전송 직전 다시 읽고 새 AI 요청을 차단한다`, async ({ page }) => {
  const fixture = await mountTutorInput(page, submitted);
  let reads: number = 0;
  await page.route("**/api/dashboard/usage", async (route): Promise<void> => {
    reads++;
    const now: number = Date.now(); const data = probeBudget(now, reads === 1 ? 137_623 : 300_000);
    if (reads === 1) { await route.fulfill({json:data}); return; }
    if (failure === "조회 실패") { await route.fulfill({status:503,json:{error:"storage_failure",message:"현재 비용 원장 조회 실패"}}); return; }
    await route.fulfill({json:failure === "오래된 원장" ? {...data,asOf:now-300_000} : failure === "지원 만료" ? {...data,ai:{...data.ai,support:data.ai.support.map((item)=>({...item,validUntil:now-1}))}} : data});
  });
  await confirmTutorAiTransmission(page,"저장한 답안 진단");
  const form = page.getByRole("form",{name:"저장한 답안 진단 전송 조건",exact:true});
  await expect(form).toContainText("US$0.300000"); await expect(form).toContainText("US$0.137623");
  await expect(form).toContainText("원화 청구 미확정"); await expect(form).toContainText("10,000원 예산 예약 유지");
  await form.getByRole("button",{name:"저장한 답안 진단",exact:true}).click();
  await expect(form.getByRole("alert")).toContainText(failure === "상한" ? "누적 검증 상한" : failure === "오래된 원장" ? "비용 관측이 오래됐어요" : failure === "지원 만료" ? "지원 확인이 만료" : "현재 비용 원장 조회 실패");
  await expect(form.getByRole("checkbox")).not.toBeChecked();
  await expect(form.getByRole("button",{name:"저장한 답안 진단",exact:true})).toBeDisabled();
  expect(reads).toBe(2); expect(fixture.actions).toEqual([]);
  await expect(page.getByText(submitted.answers[0].text,{exact:true})).toBeVisible();
});

test("화면 잔여액은 실행 허가가 아니며 서버의 요청별 예약 부족을 유지한다", async ({page}) => {
  await mountTutorInput(page,submitted);
  let reads:number=0;let requests:number=0;
  await page.route("**/api/dashboard/usage",async(route):Promise<void>=>{reads++;await route.fulfill({json:probeBudget(Date.now(),299_999)});});
  await page.route("**/api/tutor*",async(route):Promise<void>=>{expect(route.request().method()).toBe("POST");requests++;await route.fulfill({status:503,json:{error:"ai_budget_denied",message:"요청별 예약액이 남은 누적 한도를 초과했어요. 새 생성은 실행하지 않았어요."}});});
  await confirmTutorAiTransmission(page,"저장한 답안 진단");await page.getByRole("button",{name:"저장한 답안 진단",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("요청별 예약액이 남은 누적 한도를 초과");
  await expect(page.getByRole("region",{name:"AI 전송 결과 불명",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"저장한 답안 진단",exact:true})).toBeDisabled();
  expect(reads).toBe(2);expect(requests).toBe(1);
  await expect(page.getByText(submitted.answers[0].text,{exact:true})).toBeVisible();
});
