import type { ReactElement } from "react";
import { reviewFields } from "@/lib/reviews/submission";
import type { SavedReviewPlan } from "@/lib/reviews/view";

type ReviewStartProps = Readonly<{plan: SavedReviewPlan; today: string; busy: boolean; onStart: () => void}>;

export function ReviewStart({plan, today, busy, onStart}: ReviewStartProps): ReactElement {
  const active: boolean = plan.sessionId !== null && plan.sessionPhase !== "finished";
  const complete: boolean = plan.dueState === "complete";
  const proposed: boolean = plan.decision.status === "proposed";
  const future: boolean = plan.decision.dueDate > today;
  const canStart: boolean = !complete && !proposed && !future;
  const statusId: string = `review-start-status-${plan.id}`;
  const fields: string = reviewFields[plan.task.type].map((field) => `‘${field.label}’`).join(" · ");
  const guidance: string = active
    ? "시작한 복습이 있어요. 아래 버튼으로 저장한 회차를 이어가세요."
    : complete
      ? "이번 복습은 제출 결과가 확정되었어요. 다음 복습 일정을 확인해 주세요."
      : proposed
        ? "아직 복습 날짜를 수락하지 않았어요. 아래 ‘복습 날짜·조건 설정’에서 날짜와 이유를 확인하고 수락해 주세요."
        : future
          ? `${plan.decision.dueDate}부터 시작할 수 있어요. 오늘은 ${today}(서울 기준)이므로 아직 답안 입력칸이 열리지 않아요. 예정일에 이 화면을 새로고침해 주세요.`
          : "복습할 시간이 되었어요. 아래 버튼을 누르면 답안을 작성하는 화면으로 이동해요.";
  return <section className="review-start" aria-label="복습 시작과 답안 위치">
    <h3>복습 답안은 여기서 시작해요</h3>
    <p>같은 날의 복습은 연습이에요. 지연 재현은 이전 수행보다 늦은 서울 날짜의 실제 답안으로만 확인해요.</p>
    <p id={statusId} role="status">{guidance}</p>
    {active ? <a href={`/learn/tutor?id=${plan.sessionId}`}>이 복습 회차 이어가기</a>
      : <button type="button" aria-describedby={statusId} disabled={busy || !canStart} onClick={onStart}>자료 가리고 복습 시작</button>}
    {!complete && <ol>
      <li>위 버튼으로 복습을 시작하거나 이어가세요.</li>
      <li>열리는 답안 화면의 {fields} 입력칸에 직접 작성하세요.</li>
      <li>입력칸과 ‘풀이 사진’ 아래의 ‘답안 제출·저장’을 누르세요.</li>
    </ol>}
  </section>;
}
