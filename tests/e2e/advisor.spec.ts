import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { learningConditions } from "../../lib/advisor/conditions";
import { initialAdvisor, beginAdvisorAi, finishAdvisorTurn, answerDiagnosis, finishAdvisorPlan, editAdvisorPlan } from "../../lib/advisor/state";
import { advisorAction } from "../../lib/advisor/request";
import type { AdvisorState } from "../../lib/advisor/contracts";
import { recordId } from "../../lib/domain/contracts";

const origin: string = "http://127.0.0.1:5173";
test("Advisor 서버는 소유자·출처·조건 검증을 우회할 수 없다", async ({ page, request }) => {
  // 첫 API의 개발용 컴파일 시간을 포함합니다.
  test.setTimeout(60_000);
  expect((await request.get("/api/advisor")).status()).toBe(401);
  expect((await request.post("/api/advisor/acceptance", { headers: { origin }, data: { action: "start" } })).status()).toBe(401);
  await page.goto("/signin-with-chatgpt?return_to=/learn/advisor");
  expect((await page.request.post("/api/advisor", { headers: { origin: "https://evil.test" }, data: {} })).status()).toBe(403);
  for (const minutesPerWeek of [0, -1, 1.5, 10081]) {
    const response = await page.request.post("/api/advisor", { headers: { origin, "idempotency-key": randomUUID() }, data: { action: "start", id: randomUUID(), expectedVersion: 1, conditions: { title: "조건", domain: "major", purpose: "기초", selfReportedLevel: "초보", minutesPerWeek, startDate: "2026-10-24", endDate: "2026-10-30", excludedScope: [] } } });
    expect(response.status()).toBe(400);
  }
  expect((await page.request.get(`/api/advisor?id=${randomUUID()}`)).status()).toBe(409);
});

test("학습 조건을 키보드로 저장하고 새로고침해도 자기 보고가 유지된다", async ({ page }, info) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/advisor");
  await expect(page.locator(".advisor-form button[type=submit]")).toBeEnabled();
  const details = page.locator("details").filter({ has: page.getByText("새 학습 조건 입력", { exact: true }) });
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  const title: string = `조건 검증 ${info.project.name} ${randomUUID().slice(0, 5)}`;
  await page.getByLabel("학습 이름", { exact: true }).fill(title);
  await page.getByLabel("학습 목적", { exact: true }).fill("기초 학습");
  await page.getByLabel("현재 수준 · 자기 보고").fill("계산이 아직 어려움");
  await page.getByLabel("주간 학습 시간 (분)").fill("120");
  await page.getByLabel("시작일 (서울)").fill("2026-10-24"); await page.getByLabel("종료일 (서울)").fill("2026-11-20");
  await page.getByLabel("이번에 제외할 내용 · 한 줄에 하나").fill("미적분");
  await page.getByRole("button", { name: "학습 조건 저장", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText("계산이 아직 어려움", { exact: false })).toBeVisible();
  expect(await page.pageErrors()).toEqual([]);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

/** 화면의 AI 결과만 모의 처리하며 실제 D1 재개·원자성은 별도 통합 검사에서 검증합니다. */
test("한 질문·답변·계획 수정·명시적 확정 화면과 오래된 탭 안내", async ({ page }, info) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/advisor");
  const id = recordId.parse(randomUUID());
  const conditions = learningConditions.parse({ title: `화면 검증 ${info.project.name}`, domain: "practical", purpose: "비율 학습", selfReportedLevel: "초보", minutesPerWeek: 120, startDate: "2026-10-24", endDate: "2026-11-20", excludedScope: ["미적분"] });
  expect((await page.request.post("/api/advisor", { headers: { origin, "idempotency-key": randomUUID() }, data: { action: "start", id, expectedVersion: 1, conditions } })).status()).toBe(200);
  let stored: AdvisorState = initialAdvisor(id, conditions); let stale: boolean = false;
  await page.route("**/api/advisor**", async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fulfill({ json: { session: stored } }); return; }
    const action = advisorAction.parse(route.request().postDataJSON());
    if (stale) { stale = false; await route.fulfill({ status: 409, json: { error: "version_conflict", message: "다른 화면에서 변경됐어요. 최신 기록을 불러와 확인해 주세요." } }); return; }
    if (action.action === "generate") {
      const pending = beginAdvisorAi(stored); const last = stored.answers.at(-1);
      if (stored.phase === "planning") stored = finishAdvisorPlan(pending, { objective: "비율을 이해한다", prerequisites: ["곱셈"], units: [{ key: "meaning", title: "비율의 의미", objective: "설명", prerequisiteKeys: [], minutes: 60, selfExplanationCriterion: "비율 설명", newConditionCriterion: "새 비율 문제" }, { key: "ratio", title: "비율 계산", objective: "계산", prerequisiteKeys: [], minutes: 60, selfExplanationCriterion: "계산 원리 설명", newConditionCriterion: "새 농도 계산" }], excludedScope: ["미적분"], attention: ["추가 수행은 미확인"] });
      else stored = finishAdvisorTurn(pending, { kind: "advisor-turn", evaluation: last ? { answerId: last.id, quote: last.text, interpretation: "초기 추정", unverified: ["독립 수행"], category: "diagnostic-estimate" } : null, question: stored.answers.length === 2 ? null : { mode: stored.answers.length === 0 ? "explanation" : "performance", prompt: stored.answers.length === 0 ? "비율이 무엇인지 설명해 주세요." : "물 200mL에 소금 20g이면 물 100mL에는 얼마인가요?" }, readyForPlan: stored.answers.length === 2 }, randomUUID());
    } else if (action.action === "answer") stored = answerDiagnosis(stored, randomUUID(), action.answer);
    else if (action.action === "edit") stored = editAdvisorPlan(stored, action.proposal);
    else if (action.action === "confirm") stored = { ...stored, version: stored.version + 1, phase: "confirmed", confirmedPlanVersionId: recordId.parse(randomUUID()) };
    await route.fulfill({ json: { session: stored } });
  });
  await page.reload(); await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
  await page.getByRole("button", { name: "다음 진단 질문 받기", exact: true }).click();
  await expect(page.getByLabel("나의 답변", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "다음 진단 질문 받기", exact: true })).toHaveCount(0);
  await page.reload(); await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
  await expect(page.getByRole("heading", { name: "비율이 무엇인지 설명해 주세요." })).toBeVisible();
  await page.getByLabel("나의 답변", { exact: true }).fill("전체에 대한 부분입니다."); await page.getByLabel("힌트·다른 사람의 도움을 받았어요").check(); await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await page.getByRole("button", { name: "다음 진단 질문 받기", exact: true }).click();
  await expect(page.getByLabel("나의 답변", { exact: true })).toHaveCount(1);
  await page.getByLabel("나의 답변", { exact: true }).fill("10g입니다."); await page.getByRole("button", { name: "답변 저장", exact: true }).click();
  await page.getByRole("button", { name: "추가 진단 여부 확인하기", exact: true }).click();
  await page.getByRole("button", { name: "AI 계획 초안 만들기", exact: true }).click();
  await expect(page.getByRole("button", { name: "이 계획으로 확정", exact: true })).toBeDisabled();
  await page.getByLabel("학습 목표", { exact: true }).fill("취소할 목표"); await page.getByRole("button", { name: "수정 취소", exact: true }).click(); await expect(page.getByLabel("학습 목표", { exact: true })).toHaveValue("비율을 이해한다");
  await page.getByLabel("학습 목표", { exact: true }).fill("수정한 목표"); await page.getByRole("button", { name: "비율 계산 위로", exact: true }).click();
  await page.getByLabel("비율 계산 계획 시간", { exact: true }).fill("45");
  await page.getByRole("button", { name: "초안 수정 저장", exact: true }).click();
  await page.getByRole("checkbox", { name: /판의 진단 근거/ }).check(); stale = true;
  await page.getByRole("button", { name: "이 계획으로 확정", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("최신 기록");
  await page.getByRole("button", { name: "최신 기록 불러오기" }).click(); await page.getByRole("checkbox", { name: /판의 진단 근거/ }).check();
  await page.getByRole("button", { name: "이 계획으로 확정", exact: true }).click(); await expect(page.getByRole("heading", { name: "확정한 학습계획", exact: true })).toBeVisible();
  await page.screenshot({ path: `outputs/advisor-${info.project.name}.png`, fullPage: true }); expect(await page.pageErrors()).toEqual([]);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
