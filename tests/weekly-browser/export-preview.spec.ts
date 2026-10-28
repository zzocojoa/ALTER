import { expect, test } from "@playwright/test";
import { weeklyViewFixture, mountWeeklyView } from "../fixtures/weekly-ui-browser";
import { validatedWeeklyDraft } from "../../lib/weekly/workspace";
import { weeklyExportContent } from "../../lib/weekly/confirmation";
import { checkAccessibility } from "../fixtures/accessibility";

test("주간 전송 미리보기는 실제 저장 필드를 사용하고 미저장 메모·답안을 전송 내용으로 보이지 않음", async ({ page }, info): Promise<void> => {
  const view = await weeklyViewFixture(); const state = view.state;
  if (!state.proposal || state.context.availableMinutes === null) throw new Error("시험 초안 누락");
  const saved = validatedWeeklyDraft(state, { availableMinutes: state.context.availableMinutes, proposal: state.proposal, notes: "전송하지 않을 개인 메모 7721" });
  await mountWeeklyView(page, { ...view, state: saved });
  const preview = page.getByRole("region", { name: "Google 전송 전 확인", exact: true });
  await expect(preview).toContainText("ALTER 주간 성과"); await expect(preview).toContainText("Picker에서 별도로 고른 파일로 바뀌지 않아요");
  await preview.getByText("저장된 내용의 전송 미리보기", { exact: true }).click();
  for (const value of Object.values(weeklyExportContent(saved))) await expect(preview).toContainText(value);
  await expect(preview).not.toContainText(saved.notes);
  for (const answer of saved.context.aggregate.answers) await expect(preview).not.toContainText(answer.text);
  await checkAccessibility(page, ".weekly-export-preview", info);
  await page.locator('textarea[name="notes"]').fill("새로 쓴 미저장 메모");
  await expect(preview).toContainText("수정한 내용을 저장하면 전송 미리보기를 다시 확인할 수 있어요");
  await expect(preview.locator("details")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(page.getByRole("region", { name: "Google 전송 전 확인", exact: true })).toHaveCount(0);
  expect(await page.pageErrors()).toEqual([]);
});
