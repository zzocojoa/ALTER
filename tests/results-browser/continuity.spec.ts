import { expect, test } from "@playwright/test";
import { resultDraftFixture, mountResultView } from "../fixtures/result-ui-browser";
import { tutorId } from "../fixtures/tutor-state";
import type { ResultDraft } from "../../lib/results/contracts";
import { checkAccessibility } from "../fixtures/accessibility";

function confirmed(base: ResultDraft): ResultDraft {
  return { ...base, version: base.version + 1, sessionVersion: base.sessionVersion + 1, officialVersion: 2, canConfirm: false, confirmation: { id: tutorId(70), resultId: tutorId(71), version: 2, confirmedAt: 1, judgment: base.judgment }, latest: { id: tutorId(70), version: 2, performance: base.judgment.performance, progress: base.judgment.progress, nextAction: base.judgment.nextAction, correctionId: null } };
}

test("확정 응답 유실과 새로고침 뒤 같은 본문·키로만 재확인", async ({ page }): Promise<void> => {
  const draft = resultDraftFixture(); const writes: Readonly<{ key: string; body: string }>[] = [];
  await mountResultView(page, draft);
  await page.route("**/api/results", async (route): Promise<void> => {
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData()! });
    if (writes.length === 1) await route.abort("connectionreset"); else await route.fulfill({ json: confirmed(draft) });
  });
  await page.getByRole("button", { name: "내용 확인 후 공식 기록 확정", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청으로 확정 결과 확인", exact: true })).toBeEnabled();
  const metadata: string | null = await page.evaluate((id): string | null => sessionStorage.getItem(`alter:result-confirmation:${id}`), draft.id);
  expect(metadata).toContain(writes[0].key); expect(metadata).not.toContain(draft.title);
  await page.reload(); await page.getByRole("button", { name: "같은 요청으로 확정 결과 확인", exact: true }).click();
  await expect(page.getByText("공식 확정 기록", { exact: true })).toBeVisible(); expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1]);
  expect(await page.evaluate((id): string | null => sessionStorage.getItem(`alter:result-confirmation:${id}`), draft.id)).toBeNull();
});

test("다른 회차의 확정 응답과 과거 조회를 거부하고 같은 회차의 확인된 확정만 적용", async ({ page }): Promise<void> => {
  const draft = resultDraftFixture(); let mode: "wrong" | "old" | "valid" = "wrong"; let posts: number = 0;
  await mountResultView(page, draft);
  await page.route("**/api/results*", async (route): Promise<void> => {
    if (route.request().method() === "POST") { posts += 1; await route.fulfill({ json: { ...confirmed(draft), id: tutorId(999) } }); return; }
    await route.fulfill({ json: mode === "wrong" ? { ...draft, id: tutorId(999) } : mode === "old" ? { ...draft, version: draft.version - 1 } : confirmed(draft) });
  });
  await page.getByRole("button", { name: "내용 확인 후 공식 기록 확정", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("다른 회차");
  for (const next of ["wrong", "old", "valid"] as const) {
    mode = next; await page.getByRole("button", { name: "서버 최신 기록 확인", exact: true }).click();
    if (next === "valid") await expect(page.getByText("공식 확정 기록", { exact: true })).toBeVisible();
    else { await expect(page.getByRole("alert")).toContainText(next === "old" ? "과거 버전" : "다른 회차"); await expect(page.getByRole("button", { name: "같은 요청으로 확정 결과 확인", exact: true })).toBeEnabled(); }
  }
  expect(posts).toBe(1);
});

test("탭 복귀는 진행 중인 조회 다음의 새 조회를 기다리고 401 뒤에는 결과를 가림", async ({ page }): Promise<void> => {
  const draft = confirmed(resultDraftFixture()); const releases: (() => void)[] = []; let fail: boolean = false; let reads: number = 0;
  await mountResultView(page, draft);
  await page.route("**/api/results*", async (route): Promise<void> => {
    expect(route.request().method()).toBe("GET"); reads += 1;
    if (fail) { await route.fulfill({ status: 401, json: { error: "unauthenticated" } }); return; }
    if (reads <= 2) await new Promise<void>((resolve): void => { releases.push(resolve); });
    await route.fulfill({ json: draft });
  });
  await page.getByRole("button", { name: "서버 최신 기록 확인", exact: true }).click(); await expect.poll((): number => releases.length).toBe(1);
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  releases[0](); await expect.poll((): number => releases.length).toBe(2); await expect(page.locator(".result-card")).toHaveCount(0);
  releases[1](); await expect(page.getByText("공식 확정 기록", { exact: true })).toBeVisible();
  fail = true; await page.getByRole("button", { name: "서버 최신 기록 확인", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP 401"); await expect(page.locator(".result-card")).toHaveCount(0);
  fail = false; await page.getByRole("button", { name: "다시 확인", exact: true }).click(); await expect(page.getByText("공식 확정 기록", { exact: true })).toBeVisible();
});

test("버전 충돌 뒤 최신 근거를 조회하기 전에는 새 확정을 보내지 않음", async ({ page }): Promise<void> => {
  const draft = resultDraftFixture(); const newer: ResultDraft = { ...draft, version: draft.version + 1, fingerprint: "b".repeat(64) }; const writes: { key: string; body: string }[] = [];
  await mountResultView(page, draft);
  await page.route("**/api/results*", async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fulfill({ json: newer }); return; }
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postData()! });
    if (writes.length === 1) await route.fulfill({ status: 409, json: { error: "version_conflict" } }); else await route.fulfill({ json: confirmed(newer) });
  });
  const button = page.getByRole("button", { name: "내용 확인 후 공식 기록 확정", exact: true });
  await button.click(); await expect(button).toBeDisabled(); await expect(page.getByText("기록 버전이나 근거가 바뀌었어요. 서버 최신 기록을 조회한 뒤 다시 확인해 주세요.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "서버 최신 기록 확인", exact: true }).click(); await expect(button).toBeEnabled(); await button.click();
  await expect(page.getByText("공식 확정 기록", { exact: true })).toBeVisible(); expect(writes).toHaveLength(2); expect(writes[0].key).not.toBe(writes[1].key); expect(JSON.parse(writes[1].body).fingerprint).toBe(newer.fingerprint);
});

test("손상된 확정 요청 보관 값은 새 확정만 막고 조회는 유지", async ({ page }): Promise<void> => {
  const draft = resultDraftFixture(); await page.addInitScript((id): void => { sessionStorage.setItem(`alter:result-confirmation:${id}`, "{"); }, draft.id);
  await mountResultView(page, draft);
  await expect(page.getByRole("button", { name: "내용 확인 후 공식 기록 확정", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "서버 최신 기록 확인", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "서버 최신 기록 확인", exact: true }).click();
  await expect(page.getByRole("button", { name: "내용 확인 후 공식 기록 확정", exact: true })).toBeDisabled();
});

test("정정 후 현재 재검토와 과거 확정 이력을 구분하고 과거 확정이 사라진 응답을 거부", async ({ page }, info): Promise<void> => {
  const saved = confirmed(resultDraftFixture()); const currentJudgment = { ...saved.judgment, progress: "진행 중" as const, performance: "미확인" as const, unitPassed: false, explanation: null, variation: null };
  const draft: ResultDraft = { ...saved, judgment: currentJudgment, issues: ["정정된 복습 근거를 다시 확인해야 해요."], reviews: [{ id: tutorId(91), version: 2, correctionId: tutorId(92), nextAction: "정정한 질문으로 새 답안 확인", recheckState: "required" }] };
  await mountResultView(page, draft);
  const history = page.getByRole("region", { name: "확정 이력과 재검토", exact: true });
  await expect(history).toContainText("진도 완료 · 수행 독립 수행"); await expect(history).toContainText("진도 진행 중 · 수행 미확인"); await expect(history).toContainText("재검증 필요");
  await page.getByText("저장된 회차 (1)", { exact: true }).click(); await expect(page.locator('.result-history-list a[aria-current="page"]')).toHaveAttribute("href", `/learn/results?id=${draft.id}`); await expect(page.locator(".result-history-list")).toContainText("공식 확정 2판");
  await checkAccessibility(page, ".result-card", info);
  await page.route("**/api/results*", async (route): Promise<void> => { await route.fulfill({ json: { ...draft, confirmation: null } }); });
  await page.getByRole("button", { name: "서버 최신 기록 확인", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("보존된 확정 이력");
  await expect(page.getByText("공식 확정 기록", { exact: true })).toBeVisible(); await expect(history).toContainText("진도 완료 · 수행 독립 수행");
  await page.screenshot({ path: `outputs/ui-results/recheck-p4-${info.project.name}.png`, fullPage: true });
});
