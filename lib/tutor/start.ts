import { z } from "zod";
import { performance, progress, recordId, studyDate, version } from "../domain/contracts.ts";
import { tutorBundle } from "../librarian/contracts.ts";

const action = z.string().min(1).max(2000);
export const currentLearningRecord = z.object({ resultVersionId: recordId, unitId: recordId, progress, performance, correctionId: recordId.nullable(), nextAction: action.nullable() }).strict();
export type CurrentLearningRecord = Readonly<z.infer<typeof currentLearningRecord>>;
export const correctedReview = z.object({ id: recordId, unitId: recordId, version, sourceRefId: recordId, correctionId: recordId.nullable(), recheckState: z.enum(["required", "independent", "delayed"]), question: action, nextAction: action }).strict();
export type CorrectedReview = Readonly<z.infer<typeof correctedReview>>;
export const dueReview = z.object({ id: recordId, questionId: recordId, dueDate: studyDate, basisResultVersionId: recordId, currentResultVersionId: recordId.nullable(), reviewVersion: version, correctionId: recordId.nullable(), kind: z.enum(["variable", "delayed-recall"]) }).strict();
export type DueReview = Readonly<z.infer<typeof dueReview>>;
export const tutorStartContext = z.object({ scopeId: recordId, scopeVersion: version, bundle: tutorBundle, today: studyDate, latest: currentLearningRecord.nullable(), reviews: z.array(correctedReview).max(200), due: z.array(dueReview).max(200), issues: z.array(z.enum(["missing-next-action", "correction-recheck", "stale-review-schedule"])).max(3) }).strict();
export type TutorStartContext = Readonly<z.infer<typeof tutorStartContext>>;
/** 일정을 조회하지 못한 오류는 빈 목록으로 바꾸지 않고 호출자에게 전달합니다. */
export function startContextIssues(latest: CurrentLearningRecord | null, reviews: readonly CorrectedReview[], due: readonly DueReview[]): TutorStartContext["issues"] {
  const issues: TutorStartContext["issues"] = [];
  if (latest && latest.nextAction === null) issues.push("missing-next-action");
  if (reviews.some((review): boolean => review.correctionId !== null && review.recheckState === "required")) issues.push("correction-recheck");
  if (due.some((item): boolean => item.basisResultVersionId !== item.currentResultVersionId || !reviews.some((review): boolean => review.id === item.id && review.version === item.reviewVersion && review.correctionId === item.correctionId))) issues.push("stale-review-schedule");
  return issues;
}
