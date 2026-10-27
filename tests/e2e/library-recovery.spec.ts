import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { recordId } from "../../lib/domain/contracts";
import { LIBRARIAN_ACCEPTANCE_ID } from "../../lib/librarian/acceptance-fixture";
import { scopeViewReply } from "../../app/learn/library/client-api";
import type { ScopeView } from "../../app/learn/library/client-api";
import { beginScopeEvaluation, finishScopeEvaluation, confirmStudyScope } from "../../lib/librarian/state";
import { librarianAction } from "../../lib/librarian/request";
import { librarianOutputFixture } from "../fixtures/librarian-output";
import { checkAccessibility } from "../fixtures/accessibility";

type SentRequest = Readonly<{ key: string | undefined; body: string | null }>;
async function prepareScope(page: Page): Promise<ScopeView> {
  await page.goto("/signin-with-chatgpt?return_to=/learn/library");
  await page.getByText("고급 · 소유자 진단 — 자료 선정", { exact: true }).click();
  await page.getByText("Task 8 고정 자료 검증", { exact: true }).click();
  await page.getByRole("button", { name: "시험 자료 준비·저장 상태 확인", exact: true }).click();
  await expect(page.getByText(/시험 범위 기록 .*판/)).toBeVisible();
  const response = await page.request.get(`/api/librarian?id=${LIBRARIAN_ACCEPTANCE_ID}`); expect(response.status()).toBe(200);
  return scopeViewReply.parse(await response.json());
}

test("계획·원문이 바뀐 이전 확정본은 재선택을 요구하고 잘못된 응답을 적용하지 않는다", async ({ page }, info) => {
  const base = await prepareScope(page); const pending = beginScopeEvaluation(base.scope);
  const confirmed = confirmStudyScope(finishScopeEvaluation(pending, librarianOutputFixture(pending)));
  let stored: ScopeView = { ...base, scope: confirmed };
  await page.route(`**/api/librarian?id=${base.scope.input.id}`, (route) => route.fulfill({ json: stored }));
  await page.goto(`/learn/library?id=${base.scope.input.id}`);
  const writes: string[] = []; page.on("request", (request): void => { if (request.method() === "POST") writes.push(request.url()); });
  await page.getByRole("button", { name: "최신 범위 확인", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "검토한 학습 범위를 저장했어요" })).toBeVisible();
  stored = { ...stored, scope: { ...confirmed, input: { ...confirmed.input, id: recordId.parse(randomUUID()) } } };
  await page.getByRole("button", { name: "최신 범위 확인", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("다른 범위의 응답");
  stored = base;
  await page.getByRole("button", { name: "최신 범위 확인", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("더 오래된 범위 응답");
  stored = { ...base, scope: confirmed, current: false, issue: "계획·원문·수행 기록이 바뀌었어요. 이전 제안은 보관되며 새 범위를 선택해야 해요." };
  await page.getByRole("button", { name: "최신 범위 확인", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "이전 확정본" })).toBeVisible();
  await expect(page.getByRole("button", { name: "오늘의 학습 범위 확정", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "선택 자료를 AI로 비교하고 범위 제안받기", exact: true })).toHaveCount(0);
  await checkAccessibility(page, ".library-content", info);
  await page.getByRole("button", { name: "현재 계획에서 범위 다시 선택", exact: true }).click();
  await expect(page.getByRole("heading", { name: "단원", exact: true })).toBeVisible(); expect(writes).toEqual([]); expect(await page.pageErrors()).toEqual([]);
});

test("범위 저장 응답을 잃어도 입력을 잠그고 동일 요청으로 저장 하나를 확인한다", async ({ page }, info) => {
  const base = await prepareScope(page); const sent: SentRequest[] = [];
  await page.goto(`/learn/library?plan=${base.scope.input.planVersionId}`);
  await page.getByRole("button", { name: "3. 페이지·구간", exact: true }).click();
  await page.locator(`#library-scope-input input[value="${base.scope.candidates[0].link.id}"]`).check();
  await page.getByRole("button", { name: "시간 정하기 · 자료 1개", exact: true }).click();
  await page.getByLabel("가용 시간 (분)", { exact: true }).fill("30"); await page.getByLabel("질문·인출 시간 (분)", { exact: true }).fill("5"); await page.getByLabel("직접 수행 시간 (분)", { exact: true }).fill("5");
  await page.getByLabel("오늘의 학습 수준·가정 (선택)", { exact: true }).fill("응답이 없어도 보관할 입력");
  await page.route("**/api/librarian", async (route): Promise<void> => {
    sent.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() });
    const response = await route.fetch(); expect(response.status()).toBe(200);
    if (sent.length === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "비교할 자료와 시간 저장", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "미확정 저장 요청", exact: true })).toBeVisible();
  await expect(page.getByLabel("가용 시간 (분)", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("오늘의 학습 수준·가정 (선택)", { exact: true })).toHaveValue("응답이 없어도 보관할 입력");
  await page.getByRole("button", { name: "같은 요청 결과 다시 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "검토", exact: true })).toBeVisible();
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  const input = librarianAction.parse(JSON.parse(sent[0].body ?? "null")); if (input.action !== "start") throw new Error("범위 저장이 아니에요.");
  expect(page.url()).toContain(`id=${input.input.id}`);
  await page.reload(); await expect(page.getByText("이번 범위의 수준·가정: 응답이 없어도 보관할 입력", { exact: true })).toBeVisible();
  const saved = scopeViewReply.parse(await (await page.request.get(`/api/librarian?id=${input.input.id}`)).json()); expect(saved.scope.version).toBe(1); expect(saved.scope.input).toEqual(input.input);
  await checkAccessibility(page, ".library-content", info); expect(await page.pageErrors()).toEqual([]);
});

test("자료 연결 응답을 잃으면 동일 연결을 확인하고 완료 후 새 연결 입력을 준비한다", async ({ page }) => {
  const base = await prepareScope(page); const candidate = base.scope.candidates[0]; const sent: SentRequest[] = [];
  await page.goto(`/learn/library?plan=${base.scope.input.planVersionId}`);
  await page.getByRole("button", { name: "2. 자료", exact: true }).click(); await page.getByRole("combobox", { name: "자료", exact: true }).selectOption(candidate.link.materialId);
  await page.getByLabel("목차·구간 이름", { exact: true }).fill(`응답 유실 검증 ${randomUUID().slice(0,8)}`);
  await page.getByLabel("예상 읽기 시간 (분)", { exact: true }).fill("5"); await page.locator('#library-link-input input[name="sources"]').first().check();
  await page.getByLabel("저자", { exact: true }).fill(candidate.link.bibliography.author); await page.getByLabel("출처", { exact: true }).fill(candidate.link.bibliography.origin);
  await page.getByRole("combobox", { name: "본문에서 확인한 경우의 구간", exact: true }).selectOption(candidate.link.bibliography.evidenceSourceId ?? "");
  await page.getByRole("checkbox", { name: /선택한 경로의 서지 근거를 확인/ }).check();
  await page.route("**/api/librarian", async (route): Promise<void> => { sent.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData() }); const response = await route.fetch(); expect(response.status()).toBe(200); if (sent.length === 1) await route.abort("failed"); else await route.fulfill({ response }); });
  await page.getByRole("button", { name: "이 구간을 단원에 연결", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청 결과 다시 확인", exact: true })).toBeVisible();
  await expect(page.getByLabel("목차·구간 이름", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "같은 요청 결과 다시 확인", exact: true }).click();
  await expect(page.getByLabel("목차·구간 이름", { exact: true })).toHaveCount(0);
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]); const action = librarianAction.parse(JSON.parse(sent[0].body ?? "null")); if (action.action !== "link") throw new Error("자료 연결이 아니에요.");
  await expect(page.locator(`#library-scope-input input[value="${action.link.id}"]`)).toHaveCount(1);
  await page.getByRole("button", { name: "2. 자료", exact: true }).click(); await expect(page.getByRole("combobox", { name: "자료", exact: true })).toHaveValue(""); expect(await page.pageErrors()).toEqual([]);
});

/** AI는 합성 응답이며 보류 조회와 명시적 복구 사이에 자동 POST가 없어야 합니다. */
test("AI 비교 응답 미확정은 저장 상태를 읽고 같은 보류 작업을 명시적으로 복구한다", async ({ page }, info) => {
  const base = await prepareScope(page); let stored: ScopeView = base; const actions: string[] = [];
  await page.route(`**/api/librarian?id=${base.scope.input.id}`, (route) => route.fulfill({ json: stored }));
  await page.route("**/api/librarian", async (route): Promise<void> => { const input = librarianAction.parse(route.request().postDataJSON()); actions.push(input.action); if (input.action === "generate") { stored = { ...stored, scope: beginScopeEvaluation(stored.scope) }; await route.fulfill({ status: 503, json: { error: "result_unknown", message: "기존 비교 결과 확인 필요" } }); } else if (input.action === "recover") { stored = { ...stored, scope: finishScopeEvaluation(stored.scope, librarianOutputFixture(stored.scope)) }; await route.fulfill({ json: stored }); } else throw new Error("예상하지 않은 쓰기예요."); });
  await page.goto(`/learn/library?id=${base.scope.input.id}`);
  await page.getByRole("button", { name: "선택 자료를 AI로 비교하고 범위 제안받기", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청 결과 다시 확인", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "요청한 범위의 저장 상태 읽기", exact: true }).click();
  await expect(page.getByRole("button", { name: "기존 AI 비교 결과 확인", exact: true })).toBeEnabled(); expect(actions).toEqual(["generate"]);
  await page.getByRole("button", { name: "기존 AI 비교 결과 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "오늘의 학습 범위 확정", exact: true })).toBeDisabled(); expect(actions).toEqual(["generate", "recover"]);
  await checkAccessibility(page, ".library-content", info); expect(await page.pageErrors()).toEqual([]);
});

test("저장 확인이 탭 복원 조회보다 먼저 끝나면 이전 선택 응답을 가린다", async ({ page }) => {
  const base = await prepareScope(page);
  await page.goto(`/learn/library?plan=${base.scope.input.planVersionId}`);
  await page.getByRole("button", { name: "3. 페이지·구간", exact: true }).click(); await page.locator(`#library-scope-input input[value="${base.scope.candidates[0].link.id}"]`).check();
  await page.getByRole("button", { name: "시간 정하기 · 자료 1개", exact: true }).click();
  await page.getByLabel("가용 시간 (분)", { exact: true }).fill("30"); await page.getByLabel("질문·인출 시간 (분)", { exact: true }).fill("5"); await page.getByLabel("직접 수행 시간 (분)", { exact: true }).fill("5");
  let acknowledgeWrite: () => void = (): void => {}; let notifyWrite: () => void = (): void => {};
  let acknowledgeRead: () => void = (): void => {}; let notifyRead: () => void = (): void => {};
  const writeGate = new Promise<void>((resolve): void => { acknowledgeWrite = resolve; }); const writeStarted = new Promise<void>((resolve): void => { notifyWrite = resolve; });
  const readGate = new Promise<void>((resolve): void => { acknowledgeRead = resolve; }); const readStarted = new Promise<void>((resolve): void => { notifyRead = resolve; });
  await page.route("**/api/librarian", async (route): Promise<void> => { const response = await route.fetch(); expect(response.status()).toBe(200); notifyWrite(); await writeGate; await route.fulfill({ response }); });
  await page.getByRole("button", { name: "비교할 자료와 시간 저장", exact: true }).click(); await writeStarted;
  const overviewUrl: string = `**/api/librarian?unit=${base.scope.unit.unitId}`;
  await page.route(overviewUrl, async (route): Promise<void> => { const response = await route.fetch(); notifyRead(); await readGate; await route.fulfill({ response }); });
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); }); await readStarted;
  acknowledgeWrite(); await expect(page).toHaveURL(/\?id=/);
  acknowledgeRead(); await expect(page.getByRole("alert")).toContainText("확인 중 선택한 범위가 바뀌었어요");
  await expect(page.locator(".library-content")).toBeHidden();
  await page.unroute(overviewUrl); await page.getByRole("button", { name: "자료 접근 다시 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "검토", exact: true })).toBeVisible();
  expect(await page.pageErrors()).toEqual([]);
});
