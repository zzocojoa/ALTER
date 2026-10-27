import { expect, test } from "@playwright/test";
import { editorAiIntent } from "../../lib/editor/ai-observation";
import { editorAction } from "../../lib/editor/actions";
import { beginEditorFeedback, finishEditorFeedback } from "../../lib/editor/feedback";
import { finishEditorSession } from "../../lib/editor/review";
import { publicEditorView } from "../../lib/editor/view";
import { editorSubmittedFixture, editorWaitingFixture, editorReadyFixture } from "../fixtures/editor-state";
import { editorFeedbackFixture } from "../fixtures/editor-output";
import { mountEditorView } from "../fixtures/editor-ui-browser";
import { fixtureTutorBudget } from "../fixtures/tutor-budget";
import { confirmTutorAiTransmission } from "../fixtures/tutor-ai-consent";
import { checkAccessibility } from "../fixtures/accessibility";
import { tutorId } from "../fixtures/tutor-state";

test("새 첨삭 AI는 전송 동의 후에도 비용·지원 상태를 다시 확인", async ({ page }): Promise<void> => {
  await mountEditorView(page, publicEditorView(editorSubmittedFixture()));
  let reads: number = 0; let posts: number = 0; let allowed: boolean = true;
  await page.route("**/api/dashboard/usage", async (route): Promise<void> => { reads += 1; const data = fixtureTutorBudget(Date.now()); await route.fulfill({ json: allowed ? data : { ...data, ai: { ...data.ai, support: data.ai.support.map((item) => ({ ...item, state: "denied" })) } } }); });
  await page.route("**/api/editor", async (route): Promise<void> => { posts += 1; await route.fulfill({ json: publicEditorView(editorWaitingFixture()) }); });
  await expect(page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true })).toBeDisabled();
  await confirmTutorAiTransmission(page, "저장한 초안 피드백 받기");
  expect(reads).toBe(1); expect(posts).toBe(0); allowed = false;
  await page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("지원 거부"); expect(reads).toBe(2); expect(posts).toBe(0);
  allowed = true; await confirmTutorAiTransmission(page, "저장한 초안 피드백 받기");
  await page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "나의 수정본", exact: true })).toBeVisible(); expect(reads).toBe(4); expect(posts).toBe(1);
});

test("응답 유실·새로고침·조회 오류 뒤 새 생성 차단과 같은 AI 요청 조회 유지", async ({ page }, info): Promise<void> => {
  const submitted = editorSubmittedFixture();
  await mountEditorView(page, publicEditorView(submitted));
  let state = submitted;
  let mode: "unobserved" | "error" | "wrong-key" | "pending" = "unobserved";
  const posts: { key: string; body: string }[] = [];
  const reads: string[] = [];
  await page.route("**/api/editor*", async (route): Promise<void> => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === "POST") {
      posts.push({ key: request.headers()["idempotency-key"], body: request.postData()! });
      const input = editorAction.parse(request.postDataJSON());
      if (input.action === "feedback") { await route.abort("connectionreset"); return; }
      expect(input.action).toBe("recover");
      state = finishEditorFeedback(state, { id: tutorId(20), helpEventId: tutorId(21), helpAttemptId: tutorId(23), itemIds: [tutorId(22)], output: editorFeedbackFixture(state), committedAt: 2 });
      await route.fulfill({ json: publicEditorView(state) }); return;
    }
    if (url.searchParams.has("aiIntent")) {
      const intent = editorAiIntent.parse(JSON.parse(url.searchParams.get("aiIntent")!));
      reads.push(intent.key); expect(intent.key).toBe(posts[0].key); expect(intent.input).toEqual(JSON.parse(posts[0].body));
      if (mode === "error") { await route.fulfill({ status: 503, json: { error: "storage_failure", message: "합성 AI 상태 조회 실패" } }); return; }
      if (mode === "pending") state = beginEditorFeedback(submitted);
      await route.fulfill({ json: { view: publicEditorView(state), observation: { key: mode === "wrong-key" ? tutorId(99) : intent.key, status: mode === "pending" ? "pending" : "unobserved", logicalKey: state.pending?.key ?? null, version: state.pending ? state.version : null, requestId: state.pending ? tutorId(98) : null } } }); return;
    }
    await route.fulfill({ json: publicEditorView(state) });
  });
  await confirmTutorAiTransmission(page, "저장한 초안 피드백 받기"); await page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true }).click();
  const unknown = page.getByRole("region", { name: "AI 전송 결과 불명", exact: true });
  await expect(unknown).toBeVisible(); await expect(page.getByText("답안 제출을 확인했어요", { exact: true })).toBeVisible();
  await page.reload(); await expect(unknown).toBeVisible();
  const stored: string | null = await page.evaluate((id): string | null => sessionStorage.getItem("alter:editor-ai-intent:" + id), state.id);
  expect(stored).not.toContain(submitted.draft.text); expect(stored).toContain(posts[0].key);
  for (const next of ["unobserved", "error", "wrong-key"] as const) {
    mode = next; await unknown.getByRole("button", { name: "같은 AI 요청 상태 확인", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(next === "error" ? "합성 AI 상태 조회 실패" : next === "wrong-key" ? "다른 AI 요청" : "아직 확인되지");
    await expect(page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true })).toBeDisabled(); expect(posts).toHaveLength(1);
  }
  await checkAccessibility(page, ".editor-workspace", info);
  await page.screenshot({ path: `outputs/ui-editor/unknown-o5-${info.project.name}.png`, fullPage: true });
  mode = "pending"; await unknown.getByRole("button", { name: "같은 AI 요청 상태 확인", exact: true }).click();
  await expect(unknown).toHaveCount(0); await expect(page.getByRole("region", { name: "기존 AI 요청 확인", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "기존 요청 결과 확인", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "나의 수정본", exact: true })).toBeVisible();
  expect(posts.map((entry) => JSON.parse(entry.body).action)).toEqual(["feedback", "recover"]); expect(new Set(reads).size).toBe(1);
});

test("유실된 완료 결과는 같은 완료 영수증 조회로만 적용", async ({ page }): Promise<void> => {
  await mountEditorView(page, publicEditorView(editorSubmittedFixture())); let posts: number = 0;
  await page.route("**/api/editor*", async (route): Promise<void> => {
    if (route.request().method() === "POST") { posts += 1; await route.abort("timedout"); return; }
    const intent = editorAiIntent.parse(JSON.parse(new URL(route.request().url()).searchParams.get("aiIntent")!)); const complete = editorWaitingFixture();
    await route.fulfill({ json: { view: publicEditorView(complete), observation: { key: intent.key, status: "completed", logicalKey: beginEditorFeedback(editorSubmittedFixture()).pending!.key, requestId: tutorId(98), version: complete.version } } });
  });
  await confirmTutorAiTransmission(page, "저장한 초안 피드백 받기"); await page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true }).click();
  await page.getByRole("button", { name: "같은 AI 요청 상태 확인", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "나의 수정본", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "AI 전송 결과 불명", exact: true })).toHaveCount(0); expect(posts).toBe(1);
});

test("기존 복구 요청 실패와 새로고침 뒤에는 같은 복구 키 사용", async ({ page }): Promise<void> => {
  const pending = beginEditorFeedback(editorSubmittedFixture()); await mountEditorView(page, publicEditorView(pending));
  const keys: string[] = [];
  await page.route("**/api/editor", async (route): Promise<void> => { const input = editorAction.parse(route.request().postDataJSON()); expect(input.action).toBe("recover"); keys.push(route.request().headers()["idempotency-key"]); if (keys.length === 1) await route.abort("failed"); else await route.fulfill({ json: publicEditorView(editorWaitingFixture()) }); });
  await page.getByRole("button", { name: "기존 요청 결과 확인", exact: true }).click(); await expect(page.getByRole("alert")).toBeVisible();
  await page.reload(); await page.getByRole("button", { name: "기존 요청 결과 확인", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "나의 수정본", exact: true })).toBeVisible(); expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});

test("보관 식별자 오류는 새 AI만 막고 종료·저장 이력을 유지", async ({ page }): Promise<void> => {
  const submitted = editorSubmittedFixture(); await page.addInitScript((id): void => { sessionStorage.setItem("alter:editor-ai-intent:" + id, "{"); }, submitted.id);
  await mountEditorView(page, publicEditorView(submitted));
  await expect(page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "첨삭 기록 보관하고 종료 · 수행 미확정", exact: true })).toBeEnabled();
  await page.getByText("초안·수정 이유 이력 (1)", { exact: true }).click();
  await expect(page.getByRole("article", { name: "원본 초안", exact: true })).toContainText(submitted.draft.text);
});

test("개선 확인·기준 정정·종료는 독립 수행 확정으로 표시하지 않음", async ({ page }, info): Promise<void> => {
  const view = publicEditorView(finishEditorSession(editorReadyFixture()));
  await mountEditorView(page, { ...view, reviews: view.reviews.map((item) => ({ ...item, needsRecheck: true })) });
  const outcome = page.getByRole("region", { name: "개선 평가와 독립 수행 구분", exact: true });
  await expect(outcome).toContainText("원문·기준 재확인 필요"); await expect(outcome).toContainText("수행 확정 전");
  await expect(outcome.getByRole("link")).toHaveAttribute("href", `/learn/results?id=${view.tutor.id}`);
  await expect(page.getByRole("button", { name: "새 조건에서 직접 풀기", exact: true })).toHaveCount(0);
  await checkAccessibility(page, ".editor-outcome", info);
});
