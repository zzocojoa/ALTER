import type { ReactElement } from "react";
import type { SavedReviewPlan } from "@/lib/reviews/view";

/** 일정 수락은 수행 평가가 아니며 날짜 변경 이유는 서버가 보관한 값만 표시합니다. */
export function ReviewTiming({ plan, today }: Readonly<{ plan: SavedReviewPlan; today: string }>): ReactElement {
  const labels: Readonly<Record<SavedReviewPlan["decision"]["status"], string>> = { proposed: "제안 · 아직 미수락", accepted: "제안 조건으로 수락", changed: "조건 또는 날짜를 바꿔 수락" };
  return <section className="review-timing" aria-label="일정 선택과 실제 수행 구분"><h4>일정 선택과 실제 수행</h4>
    <dl><div><dt>저장된 일정 선택</dt><dd>{labels[plan.decision.status]}</dd></div><div><dt>계산된 제안 날짜</dt><dd>{plan.proposal.dueDate}</dd></div><div><dt>현재 선택 이유</dt><dd>{plan.decision.reason}</dd></div></dl>
    {plan.decision.status !== "proposed" && plan.decision.dueDate === today && <p>오늘 날짜로 수락한 일정이에요. 시작 버튼에서 가능 상태를 확인해 주세요.</p>}
    <p>날짜를 바꾸거나 수락해도 답안 제출·결과 확정이 되지는 않아요. 같은 날의 연습과 지연 재현은 따로 판단해요.</p>
    <p className="alter-caption">지연 재현은 이전 수행보다 늦은 서울 날짜에 실제 답안을 제출하고, 저장된 무도움 수행 근거를 확인해야 해요. 날짜만 앞당겨서는 지연 재현으로 바뀌지 않아요.</p>
  </section>;
}
