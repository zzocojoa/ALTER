import { RECALL_START_EVENT } from "../../lib/tutor/client-privacy";
import { expect, test } from "@playwright/test";
import { resultDraftFixture, mountResultView } from "../fixtures/result-ui-browser";
import { resultFixture } from "../fixtures/result-state";
import { tutorId } from "../fixtures/tutor-state";
import { resultEvidenceDetail, type ResultEvidenceDetail } from "../../lib/results/evidence-detail";
import { checkAccessibility } from "../fixtures/accessibility";

function detailFixture(): ResultEvidenceDetail {
  const draft = resultDraftFixture(); const state = resultFixture().states[0]; const evidence = draft.judgment.explanation!;
  const answer = state.answers.find((item): boolean => item.id === evidence.answerId)!;
  const question = state.questions.find((item): boolean => item.id === evidence.questionId)!;
  return resultEvidenceDetail.parse({ resultId: draft.id, fingerprint: draft.fingerprint, evidence, question: { id: question.id, prompt: question.prompt, criterion: state.start.bundle.unit.selfExplanationCriterion }, answer: { id: answer.id, version: evidence.answerVersion, text: answer.text, fileIds: [tutorId(102)], submittedAt: answer.submittedAt }, sources: state.start.bundle.sources.map(({ id, materialId, filePage, printedPage, spanStart, spanEnd }) => ({ id, materialId, filePage, printedPage, spanStart, spanEnd })) });
}

test("선택한 답안의 버전·당시 기준·사진·정확한 원문 구간만 명시적으로 조회", async ({ page }, info): Promise<void> => {
  const draft = resultDraftFixture(); const detail = detailFixture(); let reads: number = 0;
  await mountResultView(page, draft);
  await page.route("**/api/results*", async (route): Promise<void> => {
    const params = new URL(route.request().url()).searchParams;
    if (!params.has("answerId")) { await route.fallback(); return; }
    expect(route.request().method()).toBe("GET"); expect(params.get("id")).toBe(draft.id); expect(params.get("fingerprint")).toBe(draft.fingerprint); expect(params.get("answerId")).toBe(detail.answer.id);
    reads += 1; await route.fulfill({ json: detail });
  });
  const section = page.getByRole("region", { name: "자료 없이 핵심 설명", exact: true }); expect(reads).toBe(0);
  await section.getByText("답안·원문 근거 열기", { exact: true }).click();
  await expect(section.locator("blockquote")).toHaveText(detail.answer.text); await expect(section).toContainText(detail.question.criterion);
  await expect(section.getByRole("link", { name: "이 답안 사진 1 원본 (새 탭)", exact: true })).toHaveAttribute("href", `/api/materials/${tutorId(102)}/file`);
  await expect(section.getByRole("link", { name: /구간 .* 원문/ }).first()).toHaveAttribute("href", `/learn/source/${detail.sources[0].id}`);
  expect(reads).toBe(1); await checkAccessibility(page, ".result-card", info);
  await page.screenshot({ path: `outputs/ui-results/evidence-p3-${info.project.name}.png`, fullPage: true });
  await section.getByText("답안·원문 근거 열기", { exact: true }).click(); await expect(section.locator("blockquote")).toHaveCount(0);
  await section.getByText("답안·원문 근거 열기", { exact: true }).click(); await expect(section.locator("blockquote")).toBeVisible(); expect(reads).toBe(2);
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pagehide")); });
  await expect(page.locator(".result-evidence-detail")).toHaveCount(0);
  await page.evaluate((): void => { window.dispatchEvent(new PageTransitionEvent("pageshow")); });
  await expect(section).toBeVisible(); await expect(section.locator("blockquote")).toHaveCount(0); expect(reads).toBe(2);
});

test("다른 답안·오래된 지문·접근 거부 응답을 현재 근거로 표시하지 않음", async ({ page }): Promise<void> => {
  const detail = detailFixture(); let mode: "answer" | "fingerprint" | "denied" | "valid" = "answer";
  await mountResultView(page, resultDraftFixture());
  await page.route("**/api/results*", async (route): Promise<void> => {
    if (!new URL(route.request().url()).searchParams.has("answerId")) { await route.fallback(); return; }
    if (mode === "denied") { await route.fulfill({ status: 403, json: { error: "forbidden", message: "접근 거부" } }); return; }
    await route.fulfill({ json: mode === "answer" ? { ...detail, answer: { ...detail.answer, id: tutorId(999), text: "다른 답안 비공개" } } : mode === "fingerprint" ? { ...detail, fingerprint: "b".repeat(64) } : detail });
  });
  const section = page.getByRole("region", { name: "자료 없이 핵심 설명", exact: true });
  await section.getByText("답안·원문 근거 열기", { exact: true }).click(); await expect(section.getByRole("alert")).toContainText("다른 버전");
  for (const next of ["fingerprint", "denied", "valid"] as const) {
    mode = next; await section.getByRole("button", { name: "이 답안 근거 다시 확인", exact: true }).click();
    if (mode === "valid") await expect(section.locator("blockquote")).toHaveText(detail.answer.text);
    else { await expect(section.getByRole("alert")).toBeVisible(); await expect(section.locator("blockquote")).toHaveCount(0); }
  }
  await expect(page.getByText("다른 답안 비공개", { exact: true })).toHaveCount(0); expect(await page.pageErrors()).toEqual([]);
});

test("근거를 접거나 인출을 시작한 뒤 도착한 늦은 응답은 본문을 다시 열지 않음", async ({ page }): Promise<void> => {
  await mountResultView(page, resultDraftFixture()); let waiting: (() => void) | null = null;
  await page.route("**/api/results*", async (route): Promise<void> => {
    if (!new URL(route.request().url()).searchParams.has("answerId")) { await route.fallback(); return; }
    await new Promise<void>((resolve): void => { waiting = resolve; }); await route.fulfill({ json: detailFixture() });
  });
  const section = page.getByRole("region", { name: "자료 없이 핵심 설명", exact: true });
  for (const close of ["close", "recall"] as const) {
    waiting = null; await section.getByText("답안·원문 근거 열기", { exact: true }).click(); await expect.poll((): boolean => waiting !== null).toBe(true);
    if (close === "close") await section.getByText("답안·원문 근거 열기", { exact: true }).click();
    else await page.evaluate((name): void => { window.dispatchEvent(new Event(name)); }, RECALL_START_EVENT);
    const release: (() => void) | null = waiting; if (!release) throw new Error("지연 응답 준비 누락"); (release as () => void)();
    if (close === "close") await expect(section.locator("details")).not.toHaveAttribute("open", "");
    else { await expect(page.locator(".result-card")).toHaveCount(0); await expect(page.locator(".result-history-list")).toHaveCount(0); }
    await expect(section.locator("blockquote")).toHaveCount(0);
  }
});
