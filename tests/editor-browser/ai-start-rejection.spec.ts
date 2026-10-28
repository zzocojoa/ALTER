import { expect, test } from "@playwright/test";
import { mountEditorInput } from "../fixtures/editor-input-browser";
import { confirmTutorAiTransmission } from "../fixtures/tutor-ai-consent";
import { fixtureTutorBudget } from "../fixtures/tutor-budget";
import { publicEditorView } from "../../lib/editor/view";
import { editorSubmittedFixture } from "../fixtures/editor-state";

for (const proof of ["matching", "absent", "wrong-key"] as const) test(`시작 전 거부 증거 ${proof}: 정확히 일치할 때만 전송 잠금을 해제`, async ({ page }) => {
  const state = editorSubmittedFixture();
  await mountEditorInput(page, state);
  let posts: number = 0;
  await page.route("**/api/editor*", async (route): Promise<void> => {
    if (route.request().method() === "POST") {
      posts++;
      const key: string = route.request().headers()["idempotency-key"];
      await route.fulfill({ status: 409, json: { error: "version_conflict", message: "시작 전 거부 · 최신 기록 확인 필요", ...(proof === "absent" ? {} : { aiStartRejection: { status: "not-started", key: proof === "wrong-key" ? "00000000-0000-4000-a000-000000000999" : key, id: state.id, expectedVersion: state.version, action: "feedback" } }) } }); return;
    }
    const raw: string | null = new URL(route.request().url()).searchParams.get("aiIntent");
    const latest = publicEditorView({ ...state, version: state.version + 1 });
    await route.fulfill({ json: raw ? { view: latest, observation: { key: JSON.parse(raw).key, status: "unobserved", logicalKey: null, requestId: null, version: null } } : latest });
  });
  await confirmTutorAiTransmission(page, "저장한 초안 피드백 받기");
  await page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText("시작 전 거부");
  await expect(page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "최신 개선 기록 확인", exact: true }).click();
  const stored = await page.evaluate((id): string | null => sessionStorage.getItem(`alter:editor-ai-intent:${id}`), state.id);
  if (proof === "matching") {
    expect(stored).toBeNull();
    await expect(page.getByRole("region", { name: "AI 전송 결과 불명", exact: true })).toHaveCount(0);
    await confirmTutorAiTransmission(page, "저장한 초안 피드백 받기");
    await expect(page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true })).toBeEnabled();
  } else {
    expect(stored).not.toBeNull();
    await expect(page.getByRole("region", { name: "AI 전송 결과 불명", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "AI 전송 결과 불명", exact: true })).toBeVisible();
  }
  expect(posts).toBe(1);
});

test("전송 직전 비용 조회 중 기록이 바뀌면 이전 동의로 최신 기록을 보내지 않음", async ({ page }) => {
  const state = editorSubmittedFixture();
  await mountEditorInput(page, state);
  const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
  let reads: number = 0; const posted: unknown[] = [];
  await page.route("**/api/dashboard/usage", async (route): Promise<void> => {
    reads++; if (reads === 2) { entered.resolve(); await release.promise; }
    await route.fulfill({ json: fixtureTutorBudget(Date.now()) });
  });
  await page.route("**/api/editor*", async (route): Promise<void> => {
    if (route.request().method() === "POST") posted.push(route.request().postDataJSON());
    await route.fulfill({ json: publicEditorView({ ...state, version: state.version + 1 }) });
  });
  await confirmTutorAiTransmission(page, "저장한 초안 피드백 받기");
  await page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true }).click(); await entered.promise;
  await page.getByRole("button", { name: "최신 개선 기록 확인", exact: true }).click();
  release.resolve(); await page.waitForTimeout(250);
  expect(posted).toEqual([]);
  await expect(page.getByRole("form", { name: "저장한 초안 피드백 받기 전송 조건", exact: true }).getByRole("checkbox")).not.toBeChecked();
  await expect(page.getByRole("button", { name: "저장한 초안 피드백 받기", exact: true })).toBeDisabled();
});
