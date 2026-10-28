import { expect, test } from "@playwright/test";
import { checkAccessibility } from "../fixtures/accessibility";

test("미인증 진단·닫힌 설정·없는 주소는 비공개 정보 없이 복귀 경로를 제공", async ({ page }, info) => {
  const clientErrors: string[] = []; page.on("pageerror", error => clientErrors.push(error.message));
  await page.goto("/learn/diagnostics"); await expect(page.getByRole("heading", { name: "내 학습 공간에 로그인", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "ChatGPT로 로그인", exact: true })).toHaveAttribute("href", "/signin-with-chatgpt?return_to=%2Flearn");
  await expect(page.getByRole("heading", { name: "소유자 진단", exact: true })).toHaveCount(0); await checkAccessibility(page, "main", info);
  await page.goto("/setup"); await expect(page.getByRole("heading", { name: "소유자 확인이 닫혀 있어요", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "이 계정 확인 요청하기", exact: true })).toHaveCount(0);
  await page.goto("/this-page-does-not-exist"); await expect(page.getByRole("heading", { name: "요청한 화면을 찾지 못했어요", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "오늘 화면으로", exact: true })).toHaveAttribute("href", "/learn");
  expect(clientErrors).toEqual([]); expect(await page.pageErrors()).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await checkAccessibility(page, "main", info); await page.screenshot({ path: info.outputPath("없는-화면.png"), fullPage: true });
});

test("소유자 복원 미설정과 잘못된 기록 ID는 명확한 안내와 복귀 행동을 제공", async ({ page }, info) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  await page.goto("/restore"); await expect(page.getByRole("heading", { name: "복원 관리자 설정이 아직 없습니다", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "백업 받기", exact: true })).toHaveAttribute("href", "/learn/backup"); await checkAccessibility(page, "main", info);
  await page.goto("/learn/weekly/version?id=not-a-uuid"); await expect(page.getByRole("heading", { name: "화면을 불러오지 못했어요", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "화면 다시 열기", exact: true })).toBeVisible(); await expect(page.locator("main")).not.toContainText("not-a-uuid"); await expect(page.locator("main")).not.toContainText("ZodError");
  await checkAccessibility(page, "main", info); await page.screenshot({ path: info.outputPath("조회-오류.png"), fullPage: true });
});

test("공개 시작 화면과 환영 문구 대화상자의 접근성·작은 화면 표시", async ({ page }, info) => {
  await page.goto("/"); await checkAccessibility(page, "body", info);
  const api: string[] = []; page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) api.push(request.method()); });
  await page.getByRole("button", { name: "환영 문구 바꾸기" }).click(); await checkAccessibility(page, '[role="dialog"]', info);
  await page.getByRole("textbox", { name: "표시 이름" }).fill("새 화면 학습자"); await page.getByRole("button", { name: "적용하기" }).click();
  await expect(page.getByText("새 화면 학습자님, 반가워요.", { exact: true })).toBeVisible(); expect(api).toEqual([]); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("공개-시작.png"), fullPage: true });
});
