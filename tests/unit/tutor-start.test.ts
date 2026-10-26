import { describe, expect, it } from "vitest";
import { recordId, seoulStudyDate } from "../../lib/domain/contracts";
import { startContextIssues } from "../../lib/tutor/start";
import type { CorrectedReview, CurrentLearningRecord, DueReview } from "../../lib/tutor/start";
const id = (n: number): ReturnType<typeof recordId.parse> => recordId.parse(`00000000-0000-4000-a000-${String(n).padStart(12,"0")}`);
const review: CorrectedReview = { id: id(1),unitId: id(2),version: 2,sourceRefId: id(3),correctionId: id(4),recheckState: "required",question: "정정 질문",nextAction: "새 조건 재검증" };
const due: DueReview = { id: id(1),questionId: id(5),dueDate: "2026-10-25",basisResultVersionId: id(6),currentResultVersionId: id(6),reviewVersion: 1,correctionId: null,kind: "variable" };
describe("Tutor 회차 시작", () => {
  it("예정 복습이 없는 상태와 누락된 다음 행동을 구분한다", () => {
    expect(startContextIssues(null,[],[])).toEqual([]);
    const latest: CurrentLearningRecord = { resultVersionId: id(6),unitId: id(2),progress: "진행 중",performance: "설명 필요",correctionId: null,nextAction: null };
    expect(startContextIssues(latest,[],[])).toEqual(["missing-next-action"]);
  });
  it("정정 대기와 오래된 일정의 근거를 유지한다", () => {
    expect(startContextIssues(null,[review],[due])).toEqual(["correction-recheck","stale-review-schedule"]);
    expect(startContextIssues(null,[{...review,recheckState: "independent"}],[{...due,reviewVersion: 2,correctionId: id(4)}])).toEqual([]);
    expect(startContextIssues(null,[{...review,recheckState: "independent"}],[{...due,reviewVersion:2,correctionId:id(4),currentResultVersionId:id(7)}])).toEqual(["stale-review-schedule"]);
    expect(review.recheckState).toBe("required");
  });
  it("한국 자정 경계에서 같은 시각의 날짜를 일관되게 사용한다", () => {
    expect(seoulStudyDate(Date.parse("2026-10-24T14:59:59Z"))).toBe("2026-10-24");
    expect(seoulStudyDate(Date.parse("2026-10-24T15:00:00Z"))).toBe("2026-10-25");
  });
});
