import { resultFixture } from "../fixtures/result-state";
import { calculateResult } from "../../lib/results/evidence";
import { expect, test } from "@playwright/test";
import { resultDraftFixture, mountResultView } from "../fixtures/result-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";
import { tutorId } from "../fixtures/tutor-state";
import type { ResultDraft } from "../../lib/results/contracts";

for (const confirmed of [false, true]) test(`진도·수행·누적 도움·다음 행동 분리 · 확정 ${confirmed}`, async ({ page }, info): Promise<void> => {
  const base = resultDraftFixture();
  const input = resultFixture();
  const judgment = calculateResult({ ...input, facts: input.facts.map((fact, index) => index === 0 ? { ...fact, helpIds: JSON.stringify([tutorId(72)]) } : fact) });
  const draft: ResultDraft = { ...base, judgment, helpCount: 7, confirmation: confirmed ? { id: tutorId(70), resultId: tutorId(71), version: 2, confirmedAt: 1, judgment } : null };
  await mountResultView(page, draft);
  const summary = page.getByRole("region", { name: "진도와 수행 구분", exact: true });
  await expect(summary.locator("dt")).toHaveText(["진도", "수행 수준", "도움 제공 기록", "다음 행동"]);
  await expect(summary.locator(".result-metric-value")).toHaveText(["진행 중", "독립 수행", "7개", judgment.nextAction]);
  await expect(summary).toContainText("이 단원의 누적 기록"); await expect(summary).toContainText("지연 재현: 미확인");
  await expect(summary.getByRole("heading")).toHaveText(confirmed ? "이 회차의 확정 결과" : "확정 전 결과 후보");
  await checkAccessibility(page, ".result-card", info);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(summary.locator(".result-metric-value").nth(1)).toHaveText("독립 수행");
  await page.screenshot({ path: `outputs/ui-results/summary-p1-${confirmed}-${info.project.name}.png`, fullPage: true });
  expect(await page.pageErrors()).toEqual([]);
});
