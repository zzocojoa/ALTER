import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { advisorState } from "../../lib/advisor/contracts";
import type { AdvisorState } from "../../lib/advisor/contracts";
import { learningConditions } from "../../lib/advisor/conditions";
import { advisorAction } from "../../lib/advisor/request";
import { initialAdvisor, beginAdvisorAi, finishAdvisorTurn, answerDiagnosis, editAdvisorPlan } from "../../lib/advisor/state";
import { recordId } from "../../lib/domain/contracts";
import { checkAccessibility } from "../fixtures/accessibility";

type SentRequest = Readonly<{ key: string | undefined; body: string | null }>;
const origin: string = "http://127.0.0.1:5173";
function initialFixture(): AdvisorState {
  const conditions = learningConditions.parse({ title: `입력 보존 ${randomUUID()}`, domain: "practical", purpose: "초기 진단", selfReportedLevel: "미확인", minutesPerWeek: 120, startDate: "2026-10-24", endDate: "2026-11-20", excludedScope: ["미적분"] });
  return initialAdvisor(recordId.parse(randomUUID()), conditions);
}
async function startFixture(page: Page, state: AdvisorState): Promise<void> {
  await page.goto("/signin-with-chatgpt?return_to=/learn/advisor");
  expect((await page.request.post("/api/advisor", { headers: { origin, "idempotency-key": randomUUID() }, data: { action: "start", id: state.id, expectedVersion: 1, conditions: state.conditions } })).status()).toBe(200);
  await page.reload();
}
function planFixture(initial: AdvisorState): AdvisorState {
  return advisorState.parse({ ...initial, version: 2, phase: "draft", draft: { objective: "저장된 학습 목표", prerequisites: [], units: [{ key: "meaning", title: "분수의 의미", objective: "개념 설명", prerequisiteKeys: [], minutes: 100, selfExplanationCriterion: "자료 없이 설명", newConditionCriterion: "새로운 상황에서 풀이" }], excludedScope: ["미적분"], attention: [] } });
}

test("미저장 계획·줄바꿈을 조회와 충돌에서 유지하고 응답 유실은 같은 키로 확인한다", async ({ page }, info) => {
  const initial: AdvisorState = initialFixture(); await startFixture(page, initial);
  let stored: AdvisorState = planFixture(initial); const writes: SentRequest[] = [];
  await page.route("**/api/advisor**", async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fulfill({ json: { session: stored } }); return; }
    const action = advisorAction.parse(route.request().postDataJSON());
    expect(action.action).toBe("edit"); if (action.action !== "edit") throw new Error("계획 저장만 허용하는 시험입니다.");
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (writes.length === 1) { stored = editAdvisorPlan(stored, action.proposal); await route.fulfill({ status: 503, json: { error: "result_unknown", message: "저장 응답 유실" } }); return; }
    await route.fulfill({ json: { session: stored } });
  });
  await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
  const objective = page.getByLabel("학습 목표", { exact: true }); const exclusions = page.getByLabel("제외 범위 · 한 줄에 하나", { exact: true });
  await objective.fill("보존해야 할 수정 목표"); await exclusions.fill("미적분\n"); await exclusions.pressSequentially("선형대수");
  await expect(exclusions).toHaveValue("미적분\n선형대수");
  await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
  await expect(objective).toHaveValue("보존해야 할 수정 목표"); await expect(exclusions).toHaveValue("미적분\n선형대수");
  await page.getByRole("link", { name: "자료 보관함으로", exact: true }).click();
  await expect(page).toHaveURL(/\/learn\/advisor/); await expect(page.getByRole("alert")).toContainText("먼저 저장");
  if (!stored.draft) throw new Error("시험 계획이 없습니다.");
  stored = { ...stored, version: 3, draft: { ...stored.draft, objective: "다른 탭에서 저장한 목표" } };
  await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
  await expect(objective).toHaveValue("보존해야 할 수정 목표"); await expect(page.getByRole("alert")).toContainText("덮어쓰지 않았어요");
  await expect(page.getByRole("button", { name: "초안 수정 저장", exact: true })).toBeDisabled(); expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "작성 중 입력 버리고 최신 기록 적용" }).click();
  await expect(objective).toHaveValue("다른 탭에서 저장한 목표");
  await objective.fill("응답 유실에도 유지되는 목표"); await page.getByRole("button", { name: "초안 수정 저장", exact: true }).click();
  await expect(objective).toHaveValue("응답 유실에도 유지되는 목표"); await expect(objective).toBeDisabled();
  await expect(page.getByRole("complementary", { name: "처리 결과 확인" })).toBeVisible();
  await page.getByRole("button", { name: "같은 요청 결과 다시 확인" }).click();
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  await expect(objective).toHaveValue("응답 유실에도 유지되는 목표"); await expect(page.getByRole("button", { name: "초안 수정 저장", exact: true })).toBeDisabled();
  await checkAccessibility(page, ".advisor-content", info);
  await page.reload(); await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
  await expect(objective).toHaveValue("응답 유실에도 유지되는 목표"); expect(await page.pageErrors()).toEqual([]);
});

test("답변·도움 신고를 조회와 실패에서 보존하고 같은 요청의 한 답변만 반영한다", async ({ page }, info) => {
  const initial: AdvisorState = initialFixture(); await startFixture(page, initial);
  let stored: AdvisorState = finishAdvisorTurn(beginAdvisorAi(initial), { kind: "advisor-turn", evaluation: null, question: { mode: "explanation", prompt: "분수의 뜻을 설명하세요." }, readyForPlan: false }, randomUUID());
  const writes: SentRequest[] = [];
  await page.route("**/api/advisor**", async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fulfill({ json: { session: stored } }); return; }
    const action = advisorAction.parse(route.request().postDataJSON()); if (action.action !== "answer") throw new Error("답변 저장만 허용하는 시험입니다.");
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (writes.length === 1) { await route.fulfill({ status: 400, json: { error: "advisor_input_invalid", message: "입력 확인 시험" } }); return; }
    if (writes.length === 2) { stored = answerDiagnosis(stored, randomUUID(), action.answer); await route.abort("failed"); return; }
    await route.fulfill({ json: { session: stored } });
  });
  await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
  const answer = page.getByLabel("나의 답변", { exact: true }); await answer.fill("전체를 같은 크기로 나눈 일부입니다."); await page.getByLabel("힌트·다른 사람의 도움을 받았어요").check();
  await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
  await expect(answer).toHaveValue("전체를 같은 크기로 나눈 일부입니다."); await expect(page.getByLabel("힌트·다른 사람의 도움을 받았어요")).toBeChecked();
  await page.getByRole("button", { name: "답변 저장", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("입력 확인 시험");
  await expect(answer).toHaveValue("전체를 같은 크기로 나눈 일부입니다."); await expect(page.getByRole("button", { name: "답변 저장", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "답변 저장", exact: true }).click(); await expect(page.getByRole("button", { name: "같은 요청 결과 다시 확인" })).toBeVisible();
  await expect(answer).toHaveValue("전체를 같은 크기로 나눈 일부입니다."); await expect(answer).toBeDisabled();
  await page.getByRole("button", { name: "같은 요청 결과 다시 확인" }).click(); expect(writes[2]).toEqual(writes[1]); expect(stored.answers).toHaveLength(1);
  await page.getByText("제출한 답변과 도움 사용 기록 (1)", { exact: true }).click(); await expect(page.getByLabel("제출한 답변 본문", { exact: true })).toHaveText("전체를 같은 크기로 나눈 일부입니다.");
  await checkAccessibility(page, ".advisor-content", info); expect(await page.pageErrors()).toEqual([]);
});

test("AI 결과 불명은 읽기와 기존 요청 복구를 구분하며 새 생성으로 바꾸지 않는다", async ({ page }, info) => {
  const initial: AdvisorState = initialFixture(); await startFixture(page, initial);
  let stored: AdvisorState = initial; const actions: string[] = []; const recoveries: SentRequest[] = [];
  await page.route("**/api/advisor**", async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fulfill({ json: { session: stored } }); return; }
    const action = advisorAction.parse(route.request().postDataJSON()); actions.push(action.action);
    if (action.action === "generate") { stored = beginAdvisorAi(stored); await route.fulfill({ status: 503, json: { error: "result_unknown", message: "AI 응답 미확정 시험" } }); return; }
    if (action.action !== "recover") throw new Error("AI 기존 요청 확인만 허용하는 시험입니다.");
    recoveries.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    if (recoveries.length === 1) { await route.fulfill({ status: 503, json: { error: "result_unknown", message: "기존 결과 미확정" } }); return; }
    stored = finishAdvisorTurn(stored, { kind: "advisor-turn", evaluation: null, question: { mode: "explanation", prompt: "분수의 의미를 설명해 주세요." }, readyForPlan: false }, randomUUID());
    await route.fulfill({ json: { session: stored } });
  });
  await page.getByRole("button", { name: "다음 진단 질문 받기", exact: true }).click();
  await page.getByRole("button", { name: "AI 요청의 저장 상태 읽기" }).click();
  expect(actions).toEqual(["generate"]); await expect(page.getByRole("button", { name: "기존 AI 요청 확인", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "다음 진단 질문 받기", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "기존 AI 요청 확인", exact: true }).click();
  await page.getByRole("button", { name: "같은 요청 결과 다시 확인" }).click();
  expect(actions).toEqual(["generate", "recover", "recover"]); expect(recoveries[1]).toEqual(recoveries[0]);
  await expect(page.getByLabel("나의 답변", { exact: true })).toBeVisible(); await checkAccessibility(page, ".advisor-content", info); expect(await page.pageErrors()).toEqual([]);
});

test("조회 실패·다른 기록·역행 버전은 입력을 바꾸지 않고 빈 시간은 저장하지 않는다", async ({ page }) => {
  const initial: AdvisorState = initialFixture(); await startFixture(page, initial);
  const stored: AdvisorState = planFixture(initial); let reads: number = 0; let writes: number = 0;
  await page.route("**/api/advisor**", async (route): Promise<void> => {
    if (route.request().method() !== "GET") { writes += 1; await route.fulfill({ status: 405, json: { error: "read_only_fixture" } }); return; }
    reads += 1;
    if (reads === 2) { await route.fulfill({ status: 503, json: { error: "unavailable", message: "읽기 실패 시험" } }); return; }
    if (reads === 3) { await route.fulfill({ json: { session: { ...stored, id: recordId.parse(randomUUID()) } } }); return; }
    if (reads === 4) { await route.fulfill({ json: { session: { ...stored, version: 1 } } }); return; }
    await route.fulfill({ json: { session: stored } });
  });
  await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
  const objective = page.getByLabel("학습 목표", { exact: true }); await objective.fill("조회 오류에도 보존할 목표");
  for (let index: number = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "최신 기록 불러오기" }).click();
    await expect(page.getByRole("alert")).toBeVisible(); await expect(objective).toHaveValue("조회 오류에도 보존할 목표");
  }
  const minutes = page.getByRole("spinbutton", { name: "분수의 의미 계획 시간" }); await minutes.fill("");
  await expect(minutes).toHaveValue(""); await expect(page.getByText("빈 값은 저장하지 않아요.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "초안 수정 저장", exact: true })).toBeDisabled();
  expect(await page.evaluate((): boolean => { const event: Event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await minutes.fill("45"); await expect(page.getByRole("complementary", { name: "계획 시간 합계" })).toContainText("총 45분");
  await page.getByRole("button", { name: "수정 취소", exact: true }).click();
  expect(await page.evaluate((): boolean => { const event: Event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
  expect(writes).toBe(0);
});
