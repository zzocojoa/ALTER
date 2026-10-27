import { expect, test } from "@playwright/test";
import type { UsageDashboard } from "../../lib/dashboard/usage";
import { beginDirectTutorAnswer, saveTutorAnswer } from "../../lib/tutor/state";
import { tutorStateFixture, tutorAnswerFixture } from "../fixtures/tutor-state";
import { mountTutorInput } from "../fixtures/tutor-input-browser";
import { fixtureTutorBudget } from "../fixtures/tutor-budget";
import { checkAccessibility } from "../fixtures/accessibility";

const submitted = saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()), tutorAnswerFixture());
type BlockCase = Readonly<{ name: string; issue: string; change: (data: UsageDashboard, now: number) => UsageDashboard }>;
const blockedCases: readonly BlockCase[] = [
  { name: "누적 상한", issue: "누적 검증 상한", change: (data) => ({ ...data, ai: { ...data.ai, probeCommittedUsdMicros: 50_000 } }) },
  { name: "지원 만료", issue: "텍스트 지원 확인이 만료", change: (data, now) => ({ ...data, ai: { ...data.ai, support: data.ai.support.map((item) => ({ ...item, validUntil: now - 1 })) } }) },
  { name: "지원 거부", issue: "텍스트 기능은 현재 계정에서 지원 거부", change: (data) => ({ ...data, ai: { ...data.ai, support: data.ai.support.map((item) => ({ ...item, state: "denied" })) } }) },
  { name: "원장 만료", issue: "비용 관측이 오래됐어요", change: (data, now) => ({ ...data, asOf: now - 300_000 }) },
  { name: "결제 미확인", issue: "결제 근거의 확인 기간", change: (data) => ({ ...data, ai: { ...data.ai, funding: null } }) },
];
for (const scenario of blockedCases) test(`${scenario.name}: 클릭·Enter·직접 폼 제출에서 새 AI 요청을 보내지 않는다`, async ({ page }) => {
  const fixture = await mountTutorInput(page, submitted);
  const now: number = Date.now(); const data = scenario.change(fixtureTutorBudget(now), now);
  await page.route("**/api/dashboard/usage", (route) => route.fulfill({ json: data }));
  const form = page.getByRole("form", { name: "저장한 답안 진단 전송 조건", exact: true });
  await form.getByRole("button", { name: "비용·지원 상태 확인", exact: true }).click();
  await expect(form.getByRole("list", { name: "AI 요청 제한 사유", exact: true })).toContainText(scenario.issue);
  await expect(form.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeDisabled();
  await expect(form.getByRole("checkbox")).toBeDisabled();
  await form.evaluate((element): void => { (element as HTMLFormElement).requestSubmit(); });
  await form.getByRole("heading").click(); await page.keyboard.press("Enter");
  expect(fixture.actions).toEqual([]);
});

test("전송 동의는 비용 확인과 구분되고 재조회·새로고침 후 다시 확인한다", async ({ page }, info) => {
  const fixture = await mountTutorInput(page, submitted);
  let form = page.getByRole("form", { name: "저장한 답안 진단 전송 조건", exact: true });
  await expect(form.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeDisabled();
  await form.getByRole("button", { name: "비용·지원 상태 확인", exact: true }).click();
  await expect(form.getByRole("checkbox")).toBeEnabled();
  await expect(form.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeDisabled();
  await form.evaluate((element): void => { (element as HTMLFormElement).requestSubmit(); }); expect(fixture.actions).toEqual([]);
  await form.getByRole("checkbox").check(); await expect(form.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeEnabled();
  await expect(form).toContainText("원화 청구 미확정"); await expect(form).toContainText("기존 승인 범위");
  await checkAccessibility(page, ".tutor-panel", info);
  await page.screenshot({ path: `outputs/ui-help/consent-n3-${info.project.name}.png`, fullPage: true });
  await form.getByRole("button", { name: "비용·지원 상태 확인", exact: true }).click();
  await expect(form.getByRole("checkbox")).not.toBeChecked();
  await page.reload(); form = page.getByRole("form", { name: "저장한 답안 진단 전송 조건", exact: true });
  await expect(form.getByRole("checkbox")).not.toBeChecked();
  await expect(form.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeDisabled(); expect(fixture.actions).toEqual([]);
});

test("원장 조회 실패는 확인됨으로 표시하지 않고 도움 없이 답안을 다시 쓰는 경로를 유지한다", async ({ page }) => {
  const fixture = await mountTutorInput(page, submitted);
  await page.route("**/api/dashboard/usage", (route) => route.fulfill({ status: 503, json: { error: "storage_failure", message: "원장을 읽지 못했어요." } }));
  const form = page.getByRole("form", { name: "저장한 답안 진단 전송 조건", exact: true });
  await form.getByRole("button", { name: "비용·지원 상태 확인", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("원장을 읽지 못했어요");
  await expect(form.getByRole("checkbox")).toBeDisabled(); await expect(form.getByRole("button", { name: "저장한 답안 진단", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "답안 다시 쓰기", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "답안을 평가 대기로 보관하고 마치기", exact: true })).toBeEnabled(); expect(fixture.actions).toEqual([]);
});
