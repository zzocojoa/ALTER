import { expect, test } from "@playwright/test";
import { resultDraftFixture, mountResultView } from "../fixtures/result-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";
import { tutorId } from "../fixtures/tutor-state";

test("근거 미확인은 미충족·성취 확정과 구별하고 조회가 공식 확정을 만들지 않음", async ({ page }, info): Promise<void> => {
  const base = resultDraftFixture(); const judgment = { ...base.judgment, performance: "미확인" as const, progress: "진행 중" as const, unitPassed: false, explanation: null, variation: null, evidence: [] };
  await mountResultView(page, { ...base, judgment, canConfirm: false, issues: ["복습 답안의 저장된 진단을 먼저 확인하세요."] });
  await expect(page.getByText("확정 전 확인 필요", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "자료 없이 핵심 설명 · 미확인", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "새 조건 과제의 독립 수행 · 미확인", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "내용 확인 후 공식 기록 확정", exact: true })).toBeDisabled();
  await expect(page.getByRole("region", { name: "결과 반영 상태", exact: true })).toContainText("복습 답안의 저장된 진단을 먼저 확인하세요.");
  await page.getByRole("button", { name: "서버 최신 기록 확인", exact: true }).click();
  await expect(page.getByText("공식 확정 기록", { exact: true })).toHaveCount(0);
  await checkAccessibility(page, ".result-card", info); expect(await page.pageErrors()).toEqual([]);
});

test("미확인 수준의 사용자 확정은 기록 확정만 표시하고 성공으로 바꾸지 않음", async ({ page }, info): Promise<void> => {
  const base = resultDraftFixture(); const judgment = { ...base.judgment, performance: "미확인" as const, progress: "진행 중" as const, unitPassed: false, explanation: null, variation: null, evidence: [] };
  await mountResultView(page, { ...base, judgment, canConfirm: false, confirmation: { id: tutorId(70), resultId: tutorId(71), version: 2, confirmedAt: 1, judgment } });
  await expect(page.getByText("공식 확정 기록", { exact: true })).toBeVisible();
  const summary = page.getByRole("region", { name: "진도와 수행 구분", exact: true });
  await expect(summary.locator(".result-metric-value").nth(1)).toHaveText("미확인");
  await expect(summary).toContainText("단원 통과: 미통과 · 지연 재현: 미확인");
  await expect(page.getByRole("button", { name: "내용 확인 후 공식 기록 확정", exact: true })).toBeDisabled();
  await checkAccessibility(page, ".result-card", info);
  await page.screenshot({ path: `outputs/ui-results/status-p2-${info.project.name}.png`, fullPage: true });
});
