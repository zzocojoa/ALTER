import type { ReactElement } from "react";
import type { SavedReviewPlan } from "@/lib/reviews/view";

/** 저장된 제안의 확정 근거만 표시하며 현재 회차의 완료나 외부 전송을 추정하지 않습니다. */
export function ReviewInterval({ plan }: Readonly<{ plan: SavedReviewPlan }>): ReactElement {
  const proposal = plan.proposal;
  const labels: Readonly<Record<typeof proposal.outcome, string>> = {
    initial: "첫 복습 제안 · 이 간격의 직전 복습 평가 없음",
    "not-submitted": "미제출 · 성공이나 실패로 평가하지 않음",
    "independent-pass": "직전 확정 결과의 첫 독립 통과를 반영",
    retry: "직전 확정 결과의 재확인 필요를 반영",
  };
  return <section className="review-interval" aria-label="저장된 다음 복습 간격"><h4>저장된 다음 복습 간격</h4>
    <p>간격 {proposal.stage + 1}단계 · 기본 {proposal.baseDays}일 / 제안 {proposal.adjustedDays}일</p>
    <dl><div><dt>간격 기준 서울 날짜</dt><dd>{proposal.anchorDate}</dd></div><div><dt>계산된 다음 제안일</dt><dd>{proposal.dueDate}</dd></div><div><dt>간격 계산 근거</dt><dd>{labels[proposal.outcome]}</dd></div></dl>
    {proposal.evidence && <p>근거: 공식 결과 {proposal.evidence.resultOrdinal}판 · 확정 시각 <time dateTime={new Date(proposal.evidence.confirmedAt).toISOString()}>{new Date(proposal.evidence.confirmedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (서울)</time></p>}
    <p>{plan.decision.status === "proposed" ? "다음 일정은 아직 미수락이에요." : "현재 수락한 날짜는 위 일정 선택에서 확인해 주세요."} 이 간격은 현재 답안 제출·결과 확정이나 Google 전송 완료를 뜻하지 않아요.</p>
  </section>;
}
