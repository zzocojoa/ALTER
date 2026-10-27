import { expect, test } from "@playwright/test";
import { learningDashboard } from "../../lib/dashboard/contracts";
import { usageDashboard } from "../../lib/dashboard/usage";
import { checkAccessibility } from "../fixtures/accessibility";
test("대시보드 API의 소유자 인증·비캐시·실제 로컬 원장과 화면", async ({ page, request }, info) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => { if (/hydration|hydrated/i.test(message.text())) hydrationErrors.push(message.text()); });
  for (const path of ["/api/dashboard", "/api/dashboard/usage"]) {
    const denied = await request.get(path); expect(denied.status()).toBe(401); expect(denied.headers()["cache-control"]).toContain("no-store");
  }
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  const learning = await page.request.get("/api/dashboard"); expect(learning.status()).toBe(200); learningDashboard.parse(await learning.json());
  const usage = await page.request.get("/api/dashboard/usage"); expect(usage.status()).toBe(200); const data = usageDashboard.parse(await usage.json());
  expect(usage.headers()["cache-control"]).toContain("no-store"); expect(usage.headers().vary.split(",").map(value => value.trim())).toContain("Cookie");
  expect(data.source).toBe("saved-ledgers-no-provider-call"); expect(JSON.stringify(data)).not.toMatch(/ciphertext|accessToken|refreshToken|credentialFingerprint|accountFingerprint/);
  await expect(page.getByRole("region", { name: "학습 바로가기", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "더보기", exact: true }).click();
  await page.getByRole("link", { name: "사용량과 비용 확인", exact: true }).click();
  await expect(page.getByRole("region", { name: "사용량과 서비스 상태" })).toContainText("기능별 사용 조건");
  await expect(page.getByRole("region", { name: "사이트와 저장 공간" })).toContainText("계정 전체 R2 잔여 용량");
  await checkAccessibility(page, '.learning-dashboard', info);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `outputs/dashboard-live-local-${info.project.name}.png`, fullPage: true });
  expect(await page.pageErrors()).toEqual([]); expect(hydrationErrors).toEqual([]);
});
