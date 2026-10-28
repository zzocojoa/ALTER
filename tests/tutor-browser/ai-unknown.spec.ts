import { expect, test } from "@playwright/test";
import { tutorAiIntent } from "../../lib/tutor/ai-observation";
import { recordId } from "../../lib/domain/contracts";
import { publicTutorView } from "../../lib/tutor/view";
import { beginDirectTutorAnswer, saveTutorAnswer, beginTutorDiagnosis, finishTutorDiagnosis } from "../../lib/tutor/state";
import type { TutorState } from "../../lib/tutor/contracts";
import { tutorAction } from "../../lib/tutor/request";
import { tutorStateFixture, tutorAnswerFixture, tutorDiagnosisFixture } from "../fixtures/tutor-state";
import { mountTutorInput } from "../fixtures/tutor-input-browser";
import { confirmTutorAiTransmission } from "../fixtures/tutor-ai-consent";
import { checkAccessibility } from "../fixtures/accessibility";

const submitted: TutorState = saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()), tutorAnswerFixture());
type RequestRecord = Readonly<{ key: string; body: string }>;

test("응답 유실·새로고침·조회 오류에서 새 생성은 잠기고 원래 요청만 조회한다", async ({ page }, info) => {
  await mountTutorInput(page, submitted);
  let state: TutorState = submitted;
  let result: "unobserved" | "error" | "wrong-key" | "pending" = "unobserved";
  const posts: RequestRecord[] = []; const reads: string[] = [];
  await page.route("**/api/tutor*", async (route): Promise<void> => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "POST") {
      posts.push({ key: request.headers()["idempotency-key"], body: request.postData()! });
      const input = tutorAction.parse(request.postDataJSON());
      if (input.action === "diagnose") { await route.abort("connectionreset"); return; }
      expect(input.action).toBe("recover"); state = finishTutorDiagnosis(state, tutorDiagnosisFixture());
      await route.fulfill({ json: publicTutorView(state) }); return;
    }
    if (url.searchParams.has("aiIntent")) {
      const intent = tutorAiIntent.parse(JSON.parse(url.searchParams.get("aiIntent")!)); reads.push(intent.key);
      expect(intent.key).toBe(posts[0].key); expect(intent.input).toEqual(JSON.parse(posts[0].body));
      if (result === "error") { await route.fulfill({ status: 503, json: { error: "storage_failure", message: "시험용 상태 조회 중단" } }); return; }
      if (result === "pending") state = beginTutorDiagnosis(submitted);
      await route.fulfill({ json: { view: publicTutorView(state), observation: { key: result === "wrong-key" ? recordId.parse(crypto.randomUUID()) : intent.key, status: result === "pending" ? "pending" : "unobserved", logicalKey: state.pending?.key ?? null, version: state.pending ? state.version : null, requestId: state.pending ? recordId.parse(crypto.randomUUID()) : null } } }); return;
    }
    await route.fulfill({ json: publicTutorView(state) });
  });
  await confirmTutorAiTransmission(page, "저장한 답안 진단");
  await page.getByRole("button", { name: "저장한 답안 진단", exact: true }).click();
  const unknown = page.getByRole("region", { name: "AI 전송 결과 불명", exact: true });
  await expect(unknown).toBeVisible(); await expect(unknown).toContainText("비용은 발생할 수 있어요");
  await expect(page.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeDisabled();
  await page.reload(); await expect(unknown).toBeVisible(); await expect(unknown).toContainText(posts[0].key);
  await expect(page.getByText(submitted.answers[0].text, { exact: true })).toBeVisible();
  for (const next of ["unobserved", "error", "wrong-key"] as const) {
    result = next; await unknown.getByRole("button", { name: "같은 AI 요청 상태 확인", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(next === "error" ? "시험용 상태 조회 중단" : next === "wrong-key" ? "다른 AI 요청" : "아직 확인되지");
    await expect(page.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeDisabled(); expect(posts).toHaveLength(1);
  }
  await checkAccessibility(page, ".tutor-workspace", info);
  await page.screenshot({ path: `outputs/ui-help/unknown-n4-${info.project.name}.png`, fullPage: true });
  result = "pending"; await unknown.getByRole("button", { name: "같은 AI 요청 상태 확인", exact: true }).click();
  await expect(unknown).toHaveCount(0); await expect(page.getByRole("region", { name: "기존 AI 요청 확인", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "기존 요청 결과 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 진단 · 확정 수행 수준과 별도", exact: true })).toBeVisible();
  expect(posts.map((entry) => JSON.parse(entry.body).action)).toEqual(["diagnose", "recover"]); expect(new Set(reads).size).toBe(1);
  expect(await page.evaluate((id): string | null => sessionStorage.getItem("alter:tutor-ai-intent:" + id), state.id)).toBeNull();
});

test("완료 응답이 유실되어도 같은 완료 영수증 확인만으로 결과를 적용한다", async ({ page }) => {
  await mountTutorInput(page, submitted);
  const complete = finishTutorDiagnosis(beginTutorDiagnosis(submitted), tutorDiagnosisFixture());
  const posts: RequestRecord[] = [];
  await page.route("**/api/tutor*", async (route): Promise<void> => {
    const request = route.request();
    if (request.method() === "POST") { posts.push({ key: request.headers()["idempotency-key"], body: request.postData()! }); await route.abort("timedout"); return; }
    const intent = tutorAiIntent.parse(JSON.parse(new URL(request.url()).searchParams.get("aiIntent")!));
    await route.fulfill({ json: { view: publicTutorView(complete), observation: { key: intent.key, status: "completed", logicalKey: beginTutorDiagnosis(submitted).pending!.key, requestId: recordId.parse(crypto.randomUUID()), version: complete.version } } });
  });
  await confirmTutorAiTransmission(page, "저장한 답안 진단"); await page.getByRole("button", { name: "저장한 답안 진단", exact: true }).click();
  await expect(page.getByRole("region", { name: "AI 전송 결과 불명", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "같은 AI 요청 상태 확인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI 진단 · 확정 수행 수준과 별도", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "AI 전송 결과 불명", exact: true })).toHaveCount(0); expect(posts).toHaveLength(1);
});

test("지연 중 중복 제출과 탭 복귀가 생성 수를 늘리지 않는다", async ({ page }) => {
  await mountTutorInput(page, submitted);
  let release: () => void = (): void => { throw new Error("대기 핸들이 아직 준비되지 않았습니다."); };
  const gate = new Promise<void>((resolve): void => { release = resolve; });
  let posts: number = 0; const state = beginTutorDiagnosis(submitted);
  await page.route("**/api/tutor*", async (route): Promise<void> => {
    if (route.request().method() === "POST") { posts++; await gate; }
    await route.fulfill({ json: publicTutorView(state) });
  });
  await confirmTutorAiTransmission(page, "저장한 답안 진단");
  await page.getByRole("form", { name: "저장한 답안 진단 전송 조건" }).evaluate((form: HTMLFormElement): void => { form.requestSubmit(); form.requestSubmit(); });
  await expect.poll((): number => posts).toBe(1);
  await expect(page.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeDisabled();
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  release();
  await expect(page.getByRole("region", { name: "기존 AI 요청 확인", exact: true })).toBeVisible(); expect(posts).toBe(1);
});


test("보관 요청 메타데이터가 손상되면 새 AI만 차단하고 텍스트 작업은 유지한다", async ({ page }) => {
  await page.addInitScript((id): void => { sessionStorage.setItem("alter:tutor-ai-intent:" + id, "{"); }, submitted.id);
  const fixture = await mountTutorInput(page, submitted);
  await expect(page.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeDisabled();
  await expect(page.getByText("보관 요청 식별자를 읽지 못했어요. 브라우저 저장소 상태를 확인한 뒤 새로고침해 주세요. 새 AI 요청은 잠갔어요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "답안 다시 쓰기", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "답안을 평가 대기로 보관하고 마치기", exact: true })).toBeEnabled();
  expect(fixture.actions).toEqual([]);
});
