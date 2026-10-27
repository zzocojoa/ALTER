import { expect, test } from "@playwright/test";
import { mountGoogleReport, reportStatusFixture, reportVersionId } from "../fixtures/report-status-browser";
import { checkAccessibility } from "../fixtures/accessibility";

const states = [
  { state: "pending", text: "전송 대기" }, { state: "running", text: "전송·확인 진행 중" }, { state: "partial", text: "일부 단계만 확인됨" }, { state: "confirmed", text: "Google에서 확인됨" }, { state: "failed", text: "전송 또는 확인 실패" }, { state: "unknown", text: "전송 결과 불명" }, { state: "conflict", text: "Google 내용 충돌" },
] as const;
for (const item of states) test(`보고서 ${item.state}는 내부 저장과 외부 단계 결과를 구분`, async ({ page }, info): Promise<void> => {
  let reads: number = 0;
  await mountGoogleReport(page, async (route, path): Promise<void> => { expect(path).toBe("/api/google/reports"); expect(route.request().method()).toBe("GET"); expect(new URL(route.request().url()).searchParams.get("versionId")).toBe(reportVersionId); reads += 1; await route.fulfill({ json: reportStatusFixture(item.state, true) }); });
  const region = page.getByRole("region", { name: "Google 보고서 연동", exact: true });
  await expect(region).toContainText(item.text); await expect(region).toContainText("ALTER 내부 확정본 보관과 Google 반영은 별도");
  await expect(region).toContainText(item.state === "confirmed" ? "2/2단계 확인" : "1/2단계 확인");
  await expect(region.getByRole("link", { name: "검증된 주간 상세 보고서", exact: true })).toBeVisible();
  await expect(region.getByRole("link", { name: "검증된 주간 성과표", exact: true })).toHaveCount(item.state === "confirmed" ? 1 : 0);
  await expect(region.getByRole("button", { name: "Google 내보내기 이어서 진행", exact: true })).toHaveCount(["confirmed", "conflict"].includes(item.state) ? 0 : 1);
  await region.getByRole("button", { name: "보고서 연동 상태만 새로 확인", exact: true }).click(); expect(reads).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, ".google-report-status", info);
  await page.screenshot({ path: info.outputPath("보고서-상태.png"), fullPage: true });
  expect(await page.pageErrors()).toEqual([]);
});

test("인증·권한 확인이 필요하면 내부 보관과 외부 미완료를 구분하고 전송 버튼을 감춤", async ({ page }): Promise<void> => {
  await mountGoogleReport(page, async route => { expect(route.request().method()).toBe("GET"); await route.fulfill({ json: reportStatusFixture("unknown", false) }); });
  await expect(page.getByRole("region", { name: "Google 보고서 연동" })).toContainText("Google 연결·인증 갱신 또는 파일 권한을 확인");
  await expect(page.getByRole("link", { name: "Google 연결 확인", exact: true })).toHaveAttribute("href", "/learn/google");
  await expect(page.getByRole("button", { name: "Google 내보내기 이어서 진행", exact: true })).toHaveCount(0);
});

for (const failure of ["wrong-version", "unsafe-link", "unknown-state"] as const) test(`보고서 ${failure} 응답을 검증된 상태로 표시하지 않음`, async ({ page }): Promise<void> => {
  const initial = reportStatusFixture("confirmed", true);
  const invalid = failure === "wrong-version" ? { ...initial, versionId: "00000000-0000-4000-8000-000000001398" } : failure === "unsafe-link" ? { ...initial, documentUrl: "https://example.test/private-report" } : { ...initial, workflow: { ...initial.workflow, state: "unexpected" } };
  await mountGoogleReport(page, async route => { await route.fulfill({ json: invalid }); });
  await expect(page.getByRole("status")).toContainText("상태 재조회를 마치지 못했어요");
  await expect(page.getByRole("link")).toHaveCount(0); await expect(page.getByText("Google에서 확인됨", { exact: true })).toHaveCount(0);
});

test("조회 실패는 이전 상태임을 알리고 접근 거부는 링크와 전송 제어를 제거", async ({ page }): Promise<void> => {
  let status: number = 200;
  await mountGoogleReport(page, async route => { expect(route.request().method()).toBe("GET"); await route.fulfill({ status, json: status === 200 ? reportStatusFixture("partial", true) : { message: "시험 조회 실패" } }); });
  await expect(page.getByText("일부 단계만 확인됨", { exact: true })).toBeVisible();
  status = 503; await page.getByRole("button", { name: "보고서 연동 상태만 새로 확인" }).click();
  await expect(page.getByRole("alert")).toContainText("아래는 이전 확인 결과"); await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Google 내보내기 이어서 진행" })).toBeEnabled();
  status = 403; await page.getByRole("button", { name: "보고서 연동 상태만 새로 확인" }).click();
  await expect(page.getByText("일부 단계만 확인됨", { exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Google 내보내기 이어서 진행" })).toHaveCount(0);
  status = 200; await page.getByRole("button", { name: "보고서 연동 상태만 새로 확인" }).click();
  await expect(page.getByRole("link", { name: "검증된 주간 상세 보고서" })).toBeVisible();
});
