import { expect, test } from "@playwright/test";
import { reviewPlanFixture, mountReviewView } from "../fixtures/review-ui-browser";
import { proposeInterval } from "../../lib/reviews/schedule";
import { confirmedReviewEvidence } from "../../lib/reviews/contracts";
import { instant } from "../../lib/reviews/calendar";
import { checkAccessibility } from "../fixtures/accessibility";

for (const outcome of ["initial", "not-submitted", "independent-pass", "retry"] as const) {
  test(`저장된 간격 ${outcome}의 근거와 다음 미수락을 현재 완료와 구분`, async ({ page }, info): Promise<void> => {
    const base = reviewPlanFixture();
    const now = Date.parse("2026-10-26T01:00:00Z");
    const evidence = confirmedReviewEvidence.parse({ status: "confirmed", resultVersionId: base.evidence.resultVersionId, resultOrdinal: 4, answerId: base.evidence.answerId, submittedAt: now - 60000, confirmedAt: now, correct: outcome === "independent-pass", hidden: true, helpIds: [], exposed: false, firstAttempt: true, evaluation: "저장된 시험 평가" });
    const proposal = proposeInterval(0, outcome === "initial" || outcome === "not-submitted" ? { kind: outcome } : { kind: "confirmed", evidence }, base.proposal.conditions, instant.parse(new Date(now).toISOString()), "Asia/Seoul");
    const plan = { ...base, proposal, decision: { ...base.decision, dueDate: proposal.dueDate } };
    await mountReviewView(page, { today: "2026-10-26", plans: [plan], legacy: [] }, `#review-${plan.id}`);
    const interval = page.getByRole("region", { name: "저장된 다음 복습 간격", exact: true });
    await expect(interval).toContainText(outcome === "independent-pass" ? "간격 2단계 · 기본 3일 / 제안 3일" : "간격 1단계 · 기본 1일 / 제안 1일");
    await expect(interval).toContainText(proposal.dueDate);
    await expect(interval).toContainText("다음 일정은 아직 미수락");
    await expect(interval).toContainText("Google 전송 완료를 뜻하지 않아요");
    if (proposal.evidence) await expect(interval).toContainText("근거: 공식 결과 4판");
    else await expect(interval).not.toContainText("근거: 공식 결과");
    await expect(page.getByRole("region", { name: "완료 복습", exact: true }).locator(".review-count")).toHaveText("0개");
    await page.reload(); await expect(interval).toContainText(proposal.dueDate);
    await checkAccessibility(page, ".review-overview", info);
  });
}
