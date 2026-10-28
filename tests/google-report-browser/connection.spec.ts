import { expect, test } from "@playwright/test";
import { mountGoogleConnection } from "../fixtures/google-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";

const states = ["active", "partial", "refreshing", "refresh-unknown", "reconsent", "disconnecting", "disconnected"] as const;
for (const state of states) test(`Google ${state}의 계정·범위·만료·해제를 구분하고 조회만으로 요청하지 않음`, async ({ page }, info): Promise<void> => {
  await mountGoogleConnection(page, state, true, null);
  await expect(page.getByRole("region", { name: "연결 계정", exact: true })).toContainText("fixture-owner@example.test");
  await expect(page.getByRole("region", { name: "허용 범위", exact: true })).toContainText("선택·생성한 파일");
  await expect(page.getByRole("region", { name: "인증 유효기간", exact: true })).toContainText("2026. 11. 1.");
  await expect(page.getByRole("region", { name: "연결 해제", exact: true })).toBeVisible();
  if (["active", "partial"].includes(state)) {
    await expect(page.getByRole("region", { name: "Google 파일 선택", exact: true })).toBeVisible();
    if (state === "partial") await expect(page.getByRole("button", { name: "Google에서 파일 선택", exact: true })).toBeDisabled();
  } else await expect(page.getByRole("region", { name: "Google 파일 선택", exact: true })).toHaveCount(0);
  if (state === "disconnected") await expect(page.getByRole("region", { name: "연결 해제", exact: true })).toContainText("Google 측 철회는 확인되지 않았어요");
  if (state === "disconnecting") await expect(page.getByRole("button", { name: "Google 다시 연결하기", exact: true })).toBeDisabled();
  await page.reload(); await expect(page.getByRole("region", { name: "연결 계정", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, ".google-settings", info); expect(await page.pageErrors()).toEqual([]);
});

test("설정 미완료와 미연결·동의 취소는 사용할 수 없는 제어를 안내", async ({ page }): Promise<void> => {
  await mountGoogleConnection(page, "active", false, null);
  await expect(page.getByRole("button", { name: "Google 다시 연결하기", exact: true })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Google 파일 선택", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "허용 범위", exact: true })).toContainText("현재 연결 상태에서는 파일·일정 실행을 사용할 수 없어요");
  await page.goto("https://google.connection.test/learn/google?panel=connection&connection=none&configured=1&outcome=denied");
  await expect(page.getByRole("button", { name: "Google 연결하기", exact: true })).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("Google 연결 동의를 취소했어요");
  await expect(page.getByText("해제할 연결이 없어요.", { exact: true })).toBeVisible();
});

test("중단된 연결 해제는 같은 계정 세대로 재개하고 중복 클릭·진행 중 응답을 구분", async ({ page }): Promise<void> => {
  await mountGoogleConnection(page, "disconnecting", true, null);
  const bodies: unknown[] = []; let release: () => void = (): void => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://google.connection.test/api/google/disconnect", async (route): Promise<void> => { bodies.push(route.request().postDataJSON()); await gate; await route.fulfill({ status: 409, json: { operation: "disconnect-still-running" } }); });
  await page.getByRole("button", { name: "중단된 해제 확인", exact: true }).evaluate((button: HTMLButtonElement): void => { button.click(); button.click(); });
  await expect.poll(() => bodies.length).toBe(1);
  await expect(page.getByRole("button", { name: "중단된 해제 확인", exact: true })).toBeDisabled(); release();
  await expect(page.getByRole("status")).toContainText("해제 시작 후 2분이 지나면");
  await expect(page.getByRole("button", { name: "중단된 해제 확인", exact: true })).toBeEnabled();
  expect(bodies[0]).toEqual({ connectionId: "00000000-0000-4000-8000-000000002001", generation: 4 });
});
