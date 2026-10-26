import { describe, expect, it } from "vitest";
import { dashboardIsStale, dashboardReviews, learningDashboard } from "../../lib/dashboard/contracts";
import type { DashboardReviewSource } from "../../lib/dashboard/contracts";
import { recordId } from "../../lib/domain/contracts";
const id = recordId.parse("00000000-0000-4000-a000-000000000017");
const base: DashboardReviewSource = { id, title: "복습", decision: { status: "accepted", dueDate: "2026-10-25", reason: "확인", decidedAt: 1 }, dueState: "today", sessionId: null, sessionPhase: null };
describe("대시보드 표시 계약", () => {
  it("기존 복습 판정과 날짜를 그대로 보존하고 같은 복습은 한 번 표시한다", () => {
    expect(dashboardReviews([base, base])).toEqual([{ id, title: "복습", dueDate: "2026-10-25", dueState: "today", sessionId: null }]);
    expect(dashboardReviews([{ ...base, dueState: "overdue" }])[0].dueState).toBe("overdue");
    expect(dashboardReviews([{ ...base, dueState: "future" }, { ...base, id: recordId.parse("00000000-0000-4000-a000-000000000018"), dueState: "complete" }])).toEqual([]);
  });
  it("완료된 복습 회차로 이어가지 않고 수락·정정 대기를 유지한다", () => {
    expect(dashboardReviews([{ ...base, dueState: "recheck", sessionId: id, sessionPhase: "finished" }])[0]).toMatchObject({ dueState: "recheck", sessionId: null });
    expect(dashboardReviews([{ ...base, dueState: "proposed" }])[0].dueState).toBe("proposed");
  });
  it("시간 역행과 오래된 결과를 최신으로 표시하지 않는다", () => {
    expect(dashboardIsStale(1_000, 60_999)).toBe(false); expect(dashboardIsStale(1_000, 61_000)).toBe(true); expect(dashboardIsStale(1_000, 999)).toBe(true);
  });
  it("빈 데이터에도 조회 시각과 소유자 범위의 기준 버전을 요구한다", () => {
    expect(learningDashboard.safeParse({ scopes: [], results: [] }).success).toBe(false);
  });
});
