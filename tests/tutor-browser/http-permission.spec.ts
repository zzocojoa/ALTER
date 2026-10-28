import { expect, test } from "@playwright/test";
import { mountTutorInput } from "../fixtures/tutor-input-browser";
import { beginDirectTutorAnswer, saveTutorAnswer } from "../../lib/tutor/state";
import { publicTutorView } from "../../lib/tutor/view";
import { tutorStateFixture, tutorAnswerFixture } from "../fixtures/tutor-state";

for (const status of [401, 403, 503]) test(`비JSON HTTP ${status} 응답도 권한 상태를 보존하고 새 조회로만 복구`, async ({ page }) => {
  const state = saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()), tutorAnswerFixture());
  await mountTutorInput(page, state);
  await page.route("**/api/tutor*", async (route): Promise<void> => { await route.fulfill({ status, contentType: "text/html", body: status === 401 ? "" : "<html>upstream access failed</html>" }); });
  await page.getByRole("button", { name: "최신 수업 기록 확인", exact: true }).click();
  if (status === 401 || status === 403) {
    await expect(page.getByRole("region", { name: "현재 수업", exact: true })).toHaveCount(0);
    expect(await page.locator(".tutor-workspace").innerHTML()).not.toContain(state.answers[0].text);
  } else await expect(page.getByRole("region", { name: "현재 수업", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").first()).toContainText(`HTTP ${status}`);
  await page.route("**/api/tutor*", async (route): Promise<void> => { await route.fulfill({ json: publicTutorView(state) }); });
  await page.getByRole("button", { name: "최신 수업 기록 확인", exact: true }).click();
  await expect(page.getByRole("region", { name: "현재 수업", exact: true })).toBeVisible();
});
