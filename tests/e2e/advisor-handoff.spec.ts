import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { advisorState } from "../../lib/advisor/contracts";
import { ADVISOR_ACCEPTANCE_ID } from "../../lib/advisor/acceptance";
import { overviewReply } from "../../app/learn/library/client-api";

test("확정 계획 링크는 해당 계획의 첫 단원을 열고 기존 범위를 자동 적용하지 않는다", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/advisor");
  const response = await page.request.get(`/api/advisor?id=${ADVISOR_ACCEPTANCE_ID}`); expect(response.status()).toBe(200);
  const result: { session: unknown } = await response.json(); const plan = advisorState.parse(result.session);
  expect(plan.confirmedPlanVersionId).not.toBeNull();
  const unitsResponse = await page.request.get("/api/librarian"); expect(unitsResponse.status()).toBe(200);
  const data = overviewReply.parse(await unitsResponse.json()); const expected = data.units.find((unit): boolean => unit.planVersionId === plan.confirmedPlanVersionId);
  if (!expected) throw new Error("준비한 확정 계획의 단원을 찾을 수 없어요.");
  const mutations: string[] = []; page.on("request", (request): void => { if (request.method() === "POST" && request.url().includes("/api/")) mutations.push(request.url()); });
  await page.goto(`/learn/library?plan=${plan.confirmedPlanVersionId}#scope-setup`);
  await expect(page.getByRole("combobox", { name: "확정 계획의 단원", exact: true })).toHaveValue(expected.unitId);
  await expect(page.getByRole("status").filter({ hasText: "확정 계획에서 이어왔어요" })).toContainText("사용할 단원·자료·시간을 확인");
  await expect(page.locator(".library-bundle")).toHaveCount(0);
  await page.reload(); await expect(page.getByRole("combobox", { name: "확정 계획의 단원", exact: true })).toHaveValue(expected.unitId);
  await expect(page.getByRole("combobox", { name: "확정 계획의 단원", exact: true })).toBeEnabled();
  expect(mutations).toEqual([]); expect(await page.pageErrors()).toEqual([]);
});

test("존재하지 않는 계획·잘못된 형식·범위 혼합 링크는 다른 계획으로 넘어가지 않는다", async ({ page }) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/advisor");
  for (const query of [`plan=${randomUUID()}`, "plan=invalid", `plan=${randomUUID()}&id=${randomUUID()}`]) {
    await page.goto(`/learn/library?${query}`);
    await expect(page.getByRole("heading", { name: "확정 계획을 확인해 주세요", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("최신 확정본");
    await expect(page.getByRole("combobox", { name: "확정 계획의 단원", exact: true })).toHaveCount(0);
  }
});
