import { confirmTutorAiTransmission } from "../fixtures/tutor-ai-consent";
import { expect, test } from "@playwright/test";
import { publicTutorView } from "../../lib/tutor/view";
import { beginDirectTutorAnswer, saveTutorAnswer, beginTutorDiagnosis, finishTutorDiagnosis } from "../../lib/tutor/state";
import { tutorStateFixture, tutorAnswerFixture, tutorDiagnosisFixture } from "../fixtures/tutor-state";
import { tutorAction } from "../../lib/tutor/request";
import type { TutorState } from "../../lib/tutor/contracts";
import { mountTutorInput } from "../fixtures/tutor-input-browser";
import { checkAccessibility } from "../fixtures/accessibility";

const submitted: TutorState = saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()), tutorAnswerFixture());

test("기존 결과 확인은 조회 실패 뒤에도 같은 회차·버전·키만 보내며 새 AI 생성을 요청하지 않는다", async ({ page }, info) => {
  let state: TutorState = beginTutorDiagnosis(submitted);
  const fixture = await mountTutorInput(page, state);
  const calls: Readonly<{ body: string; key: string | undefined }>[] = [];
  await page.route("**/api/tutor*", async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fulfill({ json: publicTutorView(state) }); return; }
    const body: string = route.request().postData()!; const input = tutorAction.parse(JSON.parse(body));
    calls.push({ body, key: route.request().headers()["idempotency-key"] });
    expect(input.action).toBe("recover"); expect(input.id).toBe(state.id);
    if (calls.length < 3) { await route.fulfill({ status: calls.length === 1 ? 404 : 503, json: { error: "result_unknown", message: "기존 결과 조회 실패 · 새 생성 없음" } }); return; }
    state = finishTutorDiagnosis(state, tutorDiagnosisFixture()); await route.fulfill({ json: publicTutorView(state) });
  });
  await page.reload();
  await expect(page.getByRole("region", { name: "기존 AI 요청 확인", exact: true })).toBeVisible();
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); });
  await expect(page.getByRole("region", { name: "현재 수업", exact: true })).toHaveCount(0);
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  await expect(page.getByRole("region", { name: "기존 AI 요청 확인", exact: true })).toBeVisible();
  expect(calls).toEqual([]); expect(fixture.actions).toEqual([]);
  for (let index: number = 0; index < 2; index++) {
    await page.getByRole("button", { name: "기존 요청 결과 확인", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("기존 결과 조회 실패");
    await expect(page.locator('[data-ai-intent="new"]')).toHaveCount(0);
    if(index===0){await page.reload();await expect(page.getByRole("region",{name:"기존 AI 요청 확인",exact:true})).toBeVisible();}
  }
  await checkAccessibility(page, ".tutor-panel", info);
  await page.getByRole("button", { name: "기존 요청 결과 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 진단 · 확정 수행 수준과 별도", exact: true })).toBeVisible();
  expect(calls).toHaveLength(3); expect(new Set(calls.map((call) => call.key)).size).toBe(1); expect(new Set(calls.map((call) => call.body)).size).toBe(1);
  expect(calls[0].key).toBeTruthy();
});

test("새 진단은 명시적 버튼에서만 시작하고 대기 상태 재조회는 새 생성으로 전환하지 않는다", async ({ page }) => {
  let state: TutorState = submitted;
  await mountTutorInput(page, state);
  const actions: string[] = [];
  await page.route("**/api/tutor*", async (route): Promise<void> => {
    if (route.request().method() === "POST") {
      const input = tutorAction.parse(route.request().postDataJSON()); actions.push(input.action); expect(input.action).toBe("diagnose");
      state = beginTutorDiagnosis(state);
    }
    await route.fulfill({ json: publicTutorView(state) });
  });
  await expect(page.locator('[data-ai-intent="new"]')).toContainText("새 AI 요청"); expect(actions).toEqual([]);
  await confirmTutorAiTransmission(page, "저장한 답안 진단");
  await page.getByRole("button", { name: "저장한 답안 진단", exact: true }).click();
  await expect(page.getByRole("region", { name: "기존 AI 요청 확인", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "저장한 답안 진단", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "최신 수업 기록 확인", exact: true }).click();
  await expect(page.getByRole("region", { name: "기존 AI 요청 확인", exact: true })).toBeVisible(); expect(actions).toEqual(["diagnose"]);
});
