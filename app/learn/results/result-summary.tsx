import type { ReactElement } from "react";
import type { ResultDraft } from "@/lib/results/contracts";

/** 진도와 수행 수준은 저장된 판단을 별도 항목으로 표시하고 서로 환산하지 않습니다. */
export function ResultSummary({ draft }: Readonly<{ draft: ResultDraft }>): ReactElement {
  const judgment = draft.confirmation?.judgment ?? draft.judgment;
  const corrected = draft.reviews.filter((review): boolean => review.correctionId !== null && review.recheckState === "required");
  const nextAction: string = corrected.length > 0 ? corrected.map((review): string => review.nextAction).join(" · ") : draft.latest?.nextAction ?? judgment.nextAction;
  return <section className="result-summary" aria-label="진도와 수행 구분"><h3>{draft.confirmation ? "이 회차의 확정 결과" : "확정 전 결과 후보"}</h3><dl className="result-metrics">
    <div><dt>진도</dt><dd><span className="result-metric-value">{judgment.progress}</span><p>학습 범위의 진행 상태예요.</p></dd></div>
    <div><dt>수행 수준</dt><dd><span className="result-metric-value">{judgment.performance}</span><p>자료·도움 없이 수행한 근거는 별도로 확인해요.</p></dd></div>
    <div><dt>도움 제공 기록</dt><dd><span className="result-metric-value">{draft.helpCount}개</span><p>이 단원의 누적 기록이에요. 개수만으로 수행을 판정하지 않아요.</p></dd></div>
    <div className="result-next-action"><dt>다음 행동</dt><dd><span className="result-metric-value">{nextAction}</span><p>{corrected.length > 0 ? "정정 후 재검증 안내" : draft.latest?.nextAction ? "단원의 최신 공식 기록 기준" : "현재 결과 후보의 안내"}</p></dd></div>
  </dl><p className="result-criteria-summary">단원 통과: {judgment.unitPassed ? "통과" : "미통과"} · 지연 재현: {judgment.delayedRecall}</p><p className="alter-caption">진도 완료와 독립 수행은 다른 상태예요. 일정 도래나 화면 확인만으로 수행 수준이 바뀌지 않아요.</p></section>;
}
