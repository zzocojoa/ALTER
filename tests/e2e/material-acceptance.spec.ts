import { expect, test } from "@playwright/test";

test("소유자 화면에서 실제 제품 API 수용 검사를 실행한다", async ({ page }): Promise<void> => {
  // 원본 6개 전송과 60초 결과 확인보다 전체 제한을 길게 둡니다.
  test.setTimeout(90_000);
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  await expect(page.locator("details").filter({ has: page.getByText("자료 등록 기능 확인", { exact: true }) })).not.toHaveAttribute("inert");
  await page.getByText("자료 등록 기능 확인", { exact: true }).click();
  await page.getByRole("button", { name: "운영 자료 검사 실행", exact: true }).click();
  await expect(page.getByText("12개 운영 자료 검사를 통과했어요. 검증용 과정에서 원본을 확인할 수 있어요.", { exact: true })).toBeVisible({ timeout: 60000 });
  expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const writes: string[] = [];
  page.on("request", (request): void => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.method() + " " + request.url()); });
  await page.getByText("원본 다운로드 중단·재개 확인", { exact: true }).click();
  await page.getByRole("button", { name: "저장된 시험 원본으로 읽기 검사", exact: true }).click();
  await expect(page.getByText("원본 중단·이어받기·재조회와 자료 목록 보존을 확인했어요.", { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByLabel("원본 다운로드 검사 결과", { exact: true })).toContainText('"libraryPagesUnchanged": true');
  expect(writes).toEqual([]);
});
