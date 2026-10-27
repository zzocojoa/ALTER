import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { recordId } from "../../lib/domain/contracts";
import { tutorOverview } from "../../lib/tutor/overview";
import { tutorView, type TutorView } from "../../lib/tutor/view";
import type { TutorAction } from "../../lib/tutor/request";
import { studyScopesForProject } from "../fixtures/browser-study-scopes";

async function createHistoryRecord(request: APIRequestContext, scopeId: TutorView["id"], text: string): Promise<string> {
  async function post(input: TutorAction): Promise<TutorView> {
    const response = await request.post("/api/tutor", { headers: { origin: "http://127.0.0.1:5173", "idempotency-key": randomUUID() }, data: input });
    expect(response.status(), await response.text()).toBe(200);
    return tutorView.parse(await response.json());
  }
  const id: TutorView["id"] = recordId.parse(randomUUID());
  let state: TutorView = await post({ action: "start", id, scopeId, questionId: recordId.parse(randomUUID()), attemptId: recordId.parse(randomUUID()) });
  state = await post({ action: "direct", id, expectedVersion: state.version });
  state = await post({ action: "submit", id, expectedVersion: state.version, answerId: recordId.parse(randomUUID()), draft: { text, fileIds: [] } });
  await post({ action: "finish", id, expectedVersion: state.version });
  return id;
}

test("저장된 수업 기록 선택은 회차 URL을 바꾸고 새로고침 후에도 같은 기록을 연다", async ({ page }, testInfo) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/tutor");
  const overview = tutorOverview.parse(await (await page.request.get("/api/tutor")).json());
  const scope = overview.scopes.find((item): boolean => item.id === studyScopesForProject(testInfo.project.name).historyId);
  if (!scope) throw new Error("회차 전환 검사에 필요한 합성 학습 범위가 없습니다.");
  const firstId = await createHistoryRecord(page.request, scope.id, "첫 번째 합성 회차의 저장 답안입니다.");
  const secondId = await createHistoryRecord(page.request, scope.id, "두 번째 합성 회차의 저장 답안입니다.");
  await page.goto(`/learn/tutor?id=${firstId}`);
  await expect(page.locator(".tutor-workspace")).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "최신 수업 기록 확인", exact: true })).toBeEnabled();
  await expect(page.getByText("첫 번째 합성 회차의 저장 답안입니다.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "수업 기록", exact: true }).selectOption(secondId);
  await expect(page).toHaveURL(new RegExp(`id=${secondId}`));
  await expect(page.getByRole("combobox", { name: "수업 기록", exact: true })).toHaveValue(secondId);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "수업 기록", exact: true })).toHaveValue(secondId);
  await expect(page.getByText("두 번째 합성 회차의 저장 답안입니다.", { exact: true })).toBeVisible();
  await expect(page.getByText("첫 번째 합성 회차의 저장 답안입니다.", { exact: true })).toHaveCount(0);
  expect(await page.pageErrors()).toEqual([]);
});
