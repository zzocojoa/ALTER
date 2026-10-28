import { expect, test } from "@playwright/test";
import { tutorHelpBrowserFixture } from "../fixtures/tutor-help-browser";
import { mountTutorInput } from "../fixtures/tutor-input-browser";
import { checkAccessibility } from "../fixtures/accessibility";

for (const count of [0, 1, 2, 3, 4]) test(`도움 ${count}단계: 새로고침·탭 복귀에도 누적 이력을 유지하고 AI를 생성하지 않는다`, async ({ page }, info) => {
  const writes: string[] = [];
  page.on("request", (request): void => { if (request.method() === "POST") writes.push(request.url()); });
  await mountTutorInput(page, tutorHelpBrowserFixture(count));
  for (const operation of ["initial", "reload", "restore"] as const) {
    if (operation === "reload") await page.reload();
    if (operation === "restore") {
      await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); });
      await expect(page.getByRole("region", { name: "현재 수업", exact: true })).toHaveCount(0);
      await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pageshow")); });
    }
    const history = page.getByRole("region", { name: "도움 단계와 사용 기록", exact: true });
    await expect(history).toBeVisible();
    await expect(history).toContainText(`현재 질문 ${count}단계 · 이 회차의 도움 기록 ${count}개`);
    await expect(history.locator('.tutor-help-steps [data-used="true"]')).toHaveCount(count);
    await expect(history.locator(".tutor-help-records li")).toHaveCount(count);
    await expect(page.getByTestId("tutor-question")).toHaveCount(1);
    if (count > 0) await expect(page.getByText("도움 화면 수신 확인됨", { exact: true })).toBeVisible();
  }
  expect(writes).toEqual([]);
  await checkAccessibility(page, ".tutor-panel", info);
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (count === 4) await page.screenshot({ path: `outputs/ui-help/history-n1-${info.project.name}.png`, fullPage: true });
});

test("도움 이력 재조회 실패를 빈 이력으로 바꾸지 않고 최신 조회 성공 뒤 복원한다", async ({ page }) => {
  const fixture = await mountTutorInput(page, tutorHelpBrowserFixture(3));
  await page.route("**/api/tutor?id=*", (route) => route.fulfill({ status: 503, json: { error: "storage_failure", message: "도움 이력 조회 실패" } }));
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); });
  await expect(page.getByRole("region", { name: "현재 수업", exact: true })).toHaveCount(0);
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  await expect(page.getByRole("alert")).toContainText("도움 이력 조회 실패");
  await expect(page.getByRole("region", { name: "도움 단계와 사용 기록", exact: true })).toHaveCount(0);
  await expect(page.getByText("이 회차의 도움 기록 0개", { exact: false })).toHaveCount(0);
  await page.unroute("**/api/tutor?id=*");
  await page.getByRole("button", { name: "최신 수업 기록 확인", exact: true }).click();
  await expect(page.locator(".tutor-help-records li")).toHaveCount(3);
  expect(fixture.actions).toEqual([]);
});
