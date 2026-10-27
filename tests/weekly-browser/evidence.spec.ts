import { expect, test } from "@playwright/test";
import { weeklyViewFixture, mountWeeklyView } from "../fixtures/weekly-ui-browser";
import { tutorId } from "../fixtures/tutor-state";
import { checkAccessibility } from "../fixtures/accessibility";

test("독립 수행·도움·재확인·미확인 근거와 자기 보고를 혼합하지 않음", async ({ page }, info): Promise<void> => {
  const data = await weeklyViewFixture(); const aggregate = data.state.context.aggregate; const base = aggregate.answers[0];
  const extra = [
    { ...base, id: tutorId(1901), text: "도움 받은 답안", helped: true, accepted: false, needsRecheck: false },
    { ...base, id: tutorId(1902), text: "정정 후 재확인 답안", helped: false, accepted: false, needsRecheck: true },
    { ...base, id: tutorId(1903), text: "미확인 답안", helped: false, accepted: false, needsRecheck: false },
  ];
  await mountWeeklyView(page, { ...data, state: { ...data.state, notes: "완벽하게 숙달했다고 생각함", context: { ...data.state.context, aggregate: { ...aggregate, answers: [...aggregate.answers, ...extra], counts: { ...aggregate.counts, answers: aggregate.answers.length + 3, helpedAnswers: aggregate.counts.helpedAnswers + 1 } } } } });
  await page.getByText(/성과의 근거 · 실제 제출 답안/).click();
  await expect(page.getByRole("region", { name: "도움 사용 기록", exact: true })).toContainText("도움 받은 답안");
  await expect(page.getByRole("region", { name: "근거 재검증 필요", exact: true })).toContainText("정정 후 재확인 답안");
  await expect(page.getByRole("region", { name: "독립 수행 미확인", exact: true })).toContainText("미확인 답안");
  const independent = page.getByRole("region", { name: "독립 수행 근거 확인", exact: true });
  for (const answer of extra) await expect(independent).not.toContainText(answer.text);
  await expect(page.getByRole("region", { name: "실제 수행 근거", exact: true })).not.toContainText("완벽하게 숙달했다고 생각함");
  await expect(page.getByRole("textbox", { name: /내 메모/ })).toHaveValue("완벽하게 숙달했다고 생각함");
  expect(await page.locator('article[id^="weekly-answer-"]').count()).toBe(aggregate.answers.length + 3);
  await expect(page.getByText("검토 중인 초안 · 미확정", { exact: true })).toBeVisible();
  await checkAccessibility(page, ".weekly-workspace", info);
});
