import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { tutorId } from "./tutor-state";
import { reviewOverview, type ReviewOverview, type SavedReviewPlan } from "../../lib/reviews/view";
import { makeReviewTask } from "../../lib/reviews/contracts";
import { proposeInterval } from "../../lib/reviews/schedule";
import { instant } from "../../lib/reviews/calendar";

export function reviewPlanFixture(): SavedReviewPlan {
  const now=Date.parse("2026-10-25T01:00:00Z");const proposal=proposeInterval(0,{kind:"initial"},{goalDate:null,retentionDays:30,availableMinutes:20,requiredMinutes:10},instant.parse(new Date(now).toISOString()),"Asia/Seoul");
  const data=reviewOverview.parse({today:"2026-10-25",legacy:[],plans:[{id:tutorId(100),version:1,reviewVersion:1,errorId:tutorId(101),errorVersion:1,sourceRefId:tutorId(1),unitId:tutorId(2),title:"분수 개념",question:"분수를 자신의 말로 설명하세요.",explanation:"전체를 같은 크기로 나눈다는 기준",nextAction:"새 예시로 다시 설명",correctionId:null,recheckState:"required",evidence:{resultVersionId:tutorId(102),resultOrdinal:2,questionId:tutorId(103),answerId:tutorId(104),answerVersion:2,sourceRefIds:[tutorId(1)],helpIds:[],concept:"분수",feedback:"정의를 확인하세요.",cause:{status:"unverified"}},task:makeReviewTask("concept","새 예시 설명",tutorId(103),"분수란?",[tutorId(1)]),proposalId:tutorId(105),basisResultVersionId:tutorId(102),proposal,decision:{status:"proposed",dueDate:proposal.dueDate,reason:"첫 제안",decidedAt:now},sessionId:null,sessionPhase:null,dueState:"proposed"}]});
  return data.plans[0];
}

export async function mountReviewView(page: Page, data: ReviewOverview, fragment: string): Promise<void> {
  const script: string = await readFile(".sites-runtime/review-browser/fixture.iife.js", "utf8");
  const css: string = await readFile(".sites-runtime/review-browser/fixture.css", "utf8");
  await page.route("https://review.local.test/**", async (route): Promise<void> => {
    const pathname: string = new URL(route.request().url()).pathname;
    if (pathname === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (pathname === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    if (pathname === "/api/reviews") { expect(route.request().method()).toBe("GET"); await route.fulfill({ json: data }); return; }
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>복습 상태 검사</title><link rel="stylesheet" href="/fixture.css"><main id="review-fixture"></main><script id="review-initial" type="application/json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script><script src="/fixture.js"></script></html>` });
  });
  await page.goto(`https://review.local.test/learn/tutor${fragment}`);
  await expect(page.getByRole("heading", { name: "오늘과 다음 복습", exact: true })).toBeVisible();
}
