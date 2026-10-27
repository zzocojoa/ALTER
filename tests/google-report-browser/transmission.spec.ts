import { expect, test } from "@playwright/test";
import { mountGoogleReport, reportStatusFixture, reportVersionId, reportWorkflowId } from "../fixtures/report-status-browser";
import type { GoogleReportClientView } from "../../lib/google-report/client";

for (const state of ["pending", "partial", "unknown"] as const) test(`${state} 보고서는 페이지 재진입·새로고침·상태 조회로 쓰기를 실행하지 않음`, async ({ page }): Promise<void> => {
  const methods: string[] = [];
  await mountGoogleReport(page, async (route, path): Promise<void> => { expect(path).toBe("/api/google/reports"); methods.push(route.request().method()); await route.fulfill({ json: reportStatusFixture(state, true) }); });
  await expect(page.getByRole("button", { name: "Google 내보내기 이어서 진행" })).toBeVisible();
  await page.getByRole("button", { name: "보고서 연동 상태만 새로 확인" }).click();
  await page.reload(); await expect(page.getByRole("button", { name: "Google 내보내기 이어서 진행" })).toBeVisible();
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  expect(methods).toEqual(["GET", "GET", "GET"]);
});

test("동시 클릭은 한 번만 전송하고 결과 불명 재개는 같은 확정본·작업을 사용", async ({ page }): Promise<void> => {
  let view: GoogleReportClientView = reportStatusFixture("pending", true); const preparations: unknown[] = []; const resumptions: unknown[] = [];
  let release: () => void = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await mountGoogleReport(page, async (route, path): Promise<void> => {
    if (path === "/api/google/reports") {
      if (route.request().method() === "POST") { preparations.push(route.request().postDataJSON()); if (preparations.length === 1) await gate; }
      await route.fulfill({ json: view }); return;
    }
    if (path === "/api/external") { resumptions.push(route.request().postDataJSON()); view = reportStatusFixture(resumptions.length === 1 ? "unknown" : "confirmed", true); await route.fulfill({ json: { disposition: "retained", view: view.workflow } }); return; }
    throw new Error(`예상하지 않은 전송: ${path}`);
  });
  const send = page.getByRole("button", { name: "Google 내보내기 이어서 진행", exact: true });
  await send.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => preparations.length).toBe(1); await expect(send).toBeDisabled(); release();
  await expect(page.getByText("전송 결과 불명", { exact: true })).toBeVisible(); await expect(send).toBeEnabled();
  expect(resumptions).toEqual([{ id: reportWorkflowId }]);
  await send.click(); await expect(page.getByText("Google에서 확인됨", { exact: true })).toBeVisible();
  expect(preparations).toEqual([{ versionId: reportVersionId }, { versionId: reportVersionId }]);
  expect(resumptions).toEqual([{ id: reportWorkflowId }, { id: reportWorkflowId }]); await expect(send).toHaveCount(0);
  await page.getByRole("button", { name: "보고서 연동 상태만 새로 확인" }).click();
  expect(preparations).toHaveLength(2); expect(resumptions).toHaveLength(2);
});

test("충돌 재확인은 새 보고서 준비 없이 기존 작업의 읽기 검증만 요청", async ({ page }): Promise<void> => {
  const posts: unknown[] = [];
  await mountGoogleReport(page, async (route, path): Promise<void> => {
    if (path === "/api/google/reports") { expect(route.request().method()).toBe("GET"); await route.fulfill({ json: reportStatusFixture("conflict", true) }); return; }
    if (path === "/api/external") { posts.push(route.request().postDataJSON()); await route.fulfill({ json: { disposition: "retained", view: { state: "conflict", operations: [{ state: "conflict" }] } } }); return; }
    throw new Error(`충돌 확인 범위 밖 요청: ${path}`);
  });
  await page.getByRole("button", { name: "Google 결과 다시 확인", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("내용은 변경하지 않았어요"); expect(posts).toEqual([{ id: reportWorkflowId, action: "verify-conflict" }]);
});

test("늦은 최초 조회는 더 최근에 확인한 보고서 상태를 덮지 않음", async ({ page }): Promise<void> => {
  let reads: number = 0; let release: () => void = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  let delivered: () => void = () => {}; const completed = new Promise<void>(resolve => { delivered = resolve; });
  await mountGoogleReport(page, async route => {
    expect(route.request().method()).toBe("GET"); reads += 1; const first: boolean = reads === 1;
    if (first) await gate;
    await route.fulfill({ json: reportStatusFixture(first ? "pending" : "confirmed", true) }); if (first) delivered();
  });
  await expect.poll(() => reads).toBe(1); await page.getByRole("button", { name: "보고서 연동 상태만 새로 확인" }).click();
  await expect(page.getByText("Google에서 확인됨", { exact: true })).toBeVisible(); release(); await completed;
  await expect(page.getByText("Google에서 확인됨", { exact: true })).toBeVisible(); await expect(page.getByText("전송 대기", { exact: true })).toHaveCount(0);
});

test("다른 확정본의 전송 준비 응답은 외부 실행으로 이어지지 않음", async ({ page }): Promise<void> => {
  let posts: number = 0;
  await mountGoogleReport(page, async (route, path): Promise<void> => {
    expect(path).toBe("/api/google/reports"); const view = reportStatusFixture("pending", true);
    if (route.request().method() === "POST") { posts += 1; await route.fulfill({ json: { ...view, versionId: "00000000-0000-4000-8000-000000001398" } }); return; }
    await route.fulfill({ json: view });
  });
  await page.getByRole("button", { name: "Google 내보내기 이어서 진행" }).click();
  await expect(page.getByRole("status")).toContainText("요청한 주간 확정본과 Google 연동 응답이 달라요"); expect(posts).toBe(1);
});
