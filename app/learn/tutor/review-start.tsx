import type { ReactElement } from "react";
import { reviewFields } from "@/lib/reviews/submission";
import { reviewStartState } from "@/lib/reviews/presentation";
import type { SavedReviewPlan } from "@/lib/reviews/view";
import { ActionButton, type ActionAvailability } from "@/components/alter/action-button";

type ReviewStartProps = Readonly<{plan: SavedReviewPlan; today: string; busy: boolean; onStart: () => void}>;

export function ReviewStart({plan, today, busy, onStart}: ReviewStartProps): ReactElement {
  const state = reviewStartState(plan, today);
  const fields: string = reviewFields[plan.task.type].map((field): string => `‘${field.label}’`).join(" · ");
  const availability: ActionAvailability = busy ? { kind: "busy", reason: "서버의 저장 결과를 확인하고 있어요. 잠시 기다려 주세요." } : state.kind === "start" ? { kind: "available" } : { kind: "blocked", reason: state.reason };
  return <section className="review-start" aria-label="복습 시작과 답안 위치">
    <h3>복습 답안은 여기서 시작해요</h3>
    <dl className="review-start-dates"><div><dt>서버의 서울 오늘</dt><dd>{today}</dd></div><div><dt>{plan.decision.status === "proposed" ? "제안한 날짜 · 미수락" : "수락한 서울 날짜"}</dt><dd>{plan.decision.dueDate}</dd></div></dl>
    <p>같은 날의 복습은 연습이에요. 지연 재현은 이전 수행보다 늦은 서울 날짜의 실제 답안으로만 확인해요.</p>
    <p role="status">{busy ? "서버의 저장 결과를 확인하고 있어요. 잠시 기다려 주세요." : state.reason}</p>
    {state.kind === "resume" || state.kind === "result" ? busy ? <p>현재 요청이 끝나면 저장된 회차를 열 수 있어요.</p> : <a href={state.href}>{state.kind === "resume" ? "이 복습 회차 이어가기" : "종료한 복습 결과 확인"}</a> : <ActionButton id={`review-start-${plan.id}`} type="button" tone="primary" availability={availability} onClick={(): void => { if (state.kind === "start" && !busy) onStart(); }}>자료 가리고 복습 시작</ActionButton>}
    {!busy && (state.kind === "start" || state.kind === "resume") && <ol>
      <li>위 버튼으로 복습을 시작하거나 이어가세요.</li>
      <li>열리는 답안 화면의 {fields} 입력칸에 직접 작성하세요.</li>
      <li>입력칸과 ‘풀이 사진’ 아래의 ‘답안 제출·저장’을 누르세요.</li>
    </ol>}
  </section>;
}
