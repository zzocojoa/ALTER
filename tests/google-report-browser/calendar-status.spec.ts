import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import type { ExternalWorkflowState } from "../../lib/external/state";
import { checkAccessibility } from "../fixtures/accessibility";

async function mountCalendarState(page: Page, state: ExternalWorkflowState, target: "setup" | "schedule"): Promise<void> {
  const script = await readFile(".sites-runtime/google-report-browser/fixture.iife.js", "utf8");
  const css = await readFile(".sites-runtime/google-report-browser/fixture.css", "utf8");
  await page.route("https://calendar.local.test/**", async (route): Promise<void> => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/")) throw new Error(`조회만으로 발생한 요청: ${path}`);
    if (path === "/fixture.js") { await route.fulfill({ contentType: "text/javascript", body: script }); return; }
    if (path === "/fixture.css") { await route.fulfill({ contentType: "text/css", body: css }); return; }
    await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>일정 상태 검사</title><link rel="stylesheet" href="/fixture.css"><div id="google-fixture"></div><script src="/fixture.js"></script></html>' });
  });
  await page.goto(`https://calendar.local.test/fixture?state=${state}&target=${target}`);
}

const cases: readonly Readonly<{ state: ExternalWorkflowState; label: string }>[] = [
  { state: "pending", label: "전송 대기" }, { state: "running", label: "전송·확인 진행 중" }, { state: "partial", label: "일부 단계만 확인됨" }, { state: "confirmed", label: "Google에서 확인됨" }, { state: "failed", label: "전송 또는 확인 실패" }, { state: "unknown", label: "전송 결과 불명" }, { state: "conflict", label: "Google 내용 충돌" },
];
for (const target of ["setup", "schedule"] as const) for (const item of cases) {
  test(`${target} ${item.state}를 저장된 외부 상태대로 표시하고 자동 전송하지 않음`, async ({ page }, info): Promise<void> => {
    await mountCalendarState(page, item.state, target);
    const state = page.getByRole("region", { name: "Google 전송 상태", exact: true });
    await expect(state).toContainText(item.label);
    await expect(state).toContainText("ALTER의 복습 수락·학습 완료·지연 재현 판정과는 별도");
    if (item.state !== "confirmed") await expect(state).not.toContainText("Google에서 확인됨");
    if (target === "schedule") {
      await expect(page.getByRole("button", { name: "변경한 일정 확인", exact: true })).toBeEnabled({ enabled: item.state === "confirmed" });
      await expect(page.getByRole("button", { name: "일정 저장 이어서 확인", exact: true })).toHaveCount(["confirmed", "conflict"].includes(item.state) ? 0 : 1);
    }
    await page.reload(); await expect(state).toContainText(item.label);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await checkAccessibility(page, ".calendar-panel", info);
    expect(await page.pageErrors()).toEqual([]);
  });
}

test("실패한 같은 일정의 이어서 확인은 새 일정 생성 없이 기존 작업으로만 재개", async ({ page }): Promise<void> => {
  await mountCalendarState(page, "failed", "schedule");
  let calls: number = 0;
  await page.route("https://calendar.local.test/api/external", async (route): Promise<void> => {
    expect(route.request().postDataJSON()).toEqual({ id: "00000000-0000-4000-8000-000000001601" }); calls += 1;
    await route.fulfill({ json: { disposition: "retained", view: { state: "unknown", operations: [{ state: "unknown" }] } } });
  });
  await page.getByRole("button", { name: "일정 저장 이어서 확인", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("아직 확인되지 않은 단계");
  expect(calls).toBe(1);
  await expect(page.getByRole("button", { name: "일정 저장 이어서 확인", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Google 전송 상태", exact: true })).not.toContainText("Google에서 확인됨");
});
