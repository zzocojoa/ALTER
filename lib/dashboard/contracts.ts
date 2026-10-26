import { z } from "zod";
import { recordId, studyDate, timestamp, version } from "../domain/contracts.ts";
import { currentLearningRecord } from "../tutor/start.ts";
import { tutorState } from "../tutor/contracts.ts";
import type { SavedReviewPlan } from "../reviews/view.ts";

export const dashboardSession = z.object({ id: recordId, version, title: z.string(), course: z.string(), kind: z.enum(["tutor", "editor", "review"]), phase: tutorState.shape.phase }).strict();
export const dashboardScope = z.object({ id: recordId, version, title: z.string(), course: z.string(), date: studyDate, phase: z.enum(["linked", "evaluating", "proposed", "confirmed"]), minutes: z.number().int().nonnegative(), current: z.boolean() }).strict();
export const dashboardResult = z.object({ title: z.string(), course: z.string(), sessionId: recordId.nullable(), record: currentLearningRecord }).strict();
export const dashboardReview = z.object({ id: recordId, title: z.string(), dueDate: studyDate, dueState: z.enum(["proposed", "today", "overdue", "recheck"]), sessionId: recordId.nullable() }).strict();
export const learningDashboard = z.object({ asOf: timestamp, today: studyDate, revision: z.string().min(1), visibility: z.enum(["visible", "hidden-recall"]), scopes: z.array(dashboardScope).max(200), sessions: z.array(dashboardSession).max(200), reviews: z.array(dashboardReview).max(200), legacyReviews: z.number().int().nonnegative(), results: z.array(dashboardResult).max(200) }).strict();
export type LearningDashboard = Readonly<z.infer<typeof learningDashboard>>;
export type DashboardSession = Readonly<z.infer<typeof dashboardSession>>;
export type DashboardScope = Readonly<z.infer<typeof dashboardScope>>;
export type DashboardResult = Readonly<z.infer<typeof dashboardResult>>;
export type DashboardReview = Readonly<z.infer<typeof dashboardReview>>;

/** 복습 계약에서 판정한 상태를 사용하며 날짜나 독립 수행을 재판정하지 않습니다. */
export type DashboardReviewSource = Pick<SavedReviewPlan, "id" | "title" | "decision" | "dueState" | "sessionId" | "sessionPhase">;
export function dashboardReviews(plans: readonly DashboardReviewSource[]): readonly DashboardReview[] {
  return plans.filter((plan, index) => plans.findIndex(item => item.id === plan.id) === index)
    .filter(plan => plan.dueState !== "future" && plan.dueState !== "complete")
    .map(plan => dashboardReview.parse({ id: plan.id, title: plan.title, dueDate: plan.decision.dueDate, dueState: plan.dueState, sessionId: plan.sessionPhase === "finished" ? null : plan.sessionId }))
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id));
}
export function dashboardIsStale(asOf: number, now: number): boolean {
  return now < asOf || now - asOf >= 60_000;
}
