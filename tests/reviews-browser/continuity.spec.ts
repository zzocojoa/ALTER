import { expect, test } from "@playwright/test";
import { reviewPlanFixture, mountReviewView } from "../fixtures/review-ui-browser";
import { tutorId } from "../fixtures/tutor-state";
import { reviewAction } from "../../lib/reviews/request";
import type { ReviewOverview } from "../../lib/reviews/view";

test("미저장 날짜·이유는 가림과 복귀 뒤 유지하고 같은 요청만 재전송", async ({ page }): Promise<void> => {
  const plan = reviewPlanFixture(); let data: ReviewOverview = { today: "2026-10-25", legacy: [], plans: [plan] };
  await mountReviewView(page, data, `#review-${plan.id}`);
  const reason = page.getByRole("textbox", { name: "수락·변경 이유", exact: true }); await reason.fill("오늘 연습하고 날짜를 별도로 확인합니다.");
  await page.getByLabel("수락할 서울 날짜", { exact: true }).fill("2026-10-25");
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  await expect(reason).toBeVisible(); await expect(reason).toHaveValue("오늘 연습하고 날짜를 별도로 확인합니다.");
  const posts: Readonly<{ body: string; key: string | undefined }>[] = [];
  await page.route("**/api/reviews", async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fulfill({ json: data }); return; }
    posts.push({ body: route.request().postData() ?? "", key: route.request().headers()["idempotency-key"] });
    const input = reviewAction.parse(route.request().postDataJSON()); if (input.action !== "choose") throw new Error("허용하지 않은 시험 동작");
    if (posts.length === 1) { await route.abort("failed"); return; }
    data = { ...data, plans: [{ ...plan, version: 2, dueState: "today", decision: { status: "changed", dueDate: input.dueDate, reason: input.reason, decidedAt: 2 } }] }; await route.fulfill({ json: data });
  });
  await page.getByRole("button", { name: "이 조건과 날짜로 수락", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(reason).toBeDisabled();
  await expect(reason).toHaveValue("오늘 연습하고 날짜를 별도로 확인합니다.");
  await expect(page.getByText("전송한 입력을 보관하고 있어요. 같은 요청의 결과를 확인할 때까지 새 편집을 잠갔어요.", { exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "같은 복습 요청 결과 확인", exact: true }).click();
  expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
  await expect(page.getByRole("region", { name: "오늘 복습", exact: true })).toContainText("분수 개념");
  await expect(page.locator(`#review-${plan.id}`)).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "자료 가리고 복습 시작", exact: true })).toBeEnabled();
});

test("시작 실패·다른 회차 응답은 입력 위치로 이동하지 않고 같은 요청 재확인", async ({ page }): Promise<void> => {
  const base = reviewPlanFixture(); const plan = { ...base, dueState: "today" as const, decision: { ...base.decision, status: "accepted" as const, dueDate: "2026-10-25" } };
  await mountReviewView(page, { today: "2026-10-25", legacy: [], plans: [plan] }, `#review-${plan.id}`);
  const posts: Readonly<{ body: string; key: string | undefined }>[] = [];
  await page.route("**/api/reviews", async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fallback(); return; }
    posts.push({ body: route.request().postData() ?? "", key: route.request().headers()["idempotency-key"] });
    const input = reviewAction.parse(route.request().postDataJSON()); if (input.action !== "start") throw new Error("허용하지 않은 시험 동작");
    await route.fulfill({ json: { href: `/learn/tutor?id=${posts.length === 1 ? tutorId(199) : input.id}` } });
  });
  await page.getByRole("button", { name: "자료 가리고 복습 시작", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("요청한 회차와 다릅니다");
  await expect(page).toHaveURL(new RegExp(`#review-${plan.id}$`));
  await expect(page.locator("#tutor-answer-area textarea")).toHaveCount(0);
  await page.getByRole("button", { name: "같은 복습 요청 결과 확인", exact: true }).click();
  const input = reviewAction.parse(JSON.parse(posts[0].body));
  await expect(page).toHaveURL(`https://review.local.test/learn/tutor?id=${input.id}#tutor-answer-area`);
  expect(posts[1]).toEqual(posts[0]);
});

test("늦은 시작 응답은 복귀 후 자동 이동하지 않고 중복 클릭은 하나의 요청만 전송", async ({ page }): Promise<void> => {
  const base = reviewPlanFixture(); const plan = { ...base, dueState: "today" as const, decision: { ...base.decision, status: "accepted" as const, dueDate: "2026-10-25" } };
  await mountReviewView(page, { today: "2026-10-25", legacy: [], plans: [plan] }, `#review-${plan.id}`);
  let release: (() => void) | null = null; let calls: number = 0;
  await page.route("**/api/reviews", async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fallback(); return; }
    calls += 1; const input = reviewAction.parse(route.request().postDataJSON());
    await new Promise<void>((resolve): void => { release = resolve; });
    await route.fulfill({ json: { href: `/learn/tutor?id=${input.id}` } });
  });
  await page.getByRole("button", { name: "자료 가리고 복습 시작", exact: true }).click();
  await expect.poll((): boolean => release !== null).toBe(true);
  await expect(page.getByRole("button", { name: "같은 복습 요청 결과 확인", exact: true })).toBeDisabled();
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  const finish: (() => void) | null = release; if (!finish) throw new Error("지연 응답 준비 누락"); (finish as () => void)();
  await expect(page.getByRole("heading", { name: "오늘과 다음 복습", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#review-${plan.id}$`)); expect(calls).toBe(1);
  await expect(page.getByRole("button", { name: "같은 복습 요청 결과 확인", exact: true })).toBeEnabled();
});

test("오래된 조회와 권한 실패는 복습 내용을 가린 채 보존", async ({ page }): Promise<void> => {
  const plan = { ...reviewPlanFixture(), version: 2 };
  await mountReviewView(page, { today: "2026-10-25", legacy: [], plans: [plan] }, `#review-${plan.id}`);
  await page.getByRole("textbox", { name: "수락·변경 이유", exact: true }).fill("보존할 날짜 변경 이유");
  await page.route("**/api/reviews", async (route): Promise<void> => { await route.fulfill({ json: { today: "2026-10-25", legacy: [], plans: [{ ...plan, version: 1 }] } }); });
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  await expect(page.getByRole("status")).toContainText("이전 버전의 복습 목록");
  await expect(page.locator("#reviews")).toBeHidden();
  await page.route("**/api/reviews", async (route): Promise<void> => { await route.fulfill({ status: 403, json: { error: "forbidden" } }); });
  await page.getByRole("button", { name: "복습 목록 접근 다시 확인", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("HTTP 403"); await expect(page.locator("#reviews")).toBeHidden();
  expect(await page.locator("#reviews textarea").first().inputValue()).toBe("보존할 날짜 변경 이유");
});
