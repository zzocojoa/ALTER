import type { ReactElement } from "react";
import type { ResultDraft } from "@/lib/results/contracts";

/** 확정 이후의 화면 이동만 제공하며 일정 수락·통과·수업 시작을 대신 실행하지 않습니다. */
export function ResultNext({ draft }: Readonly<{ draft: ResultDraft }>): ReactElement | null {
  if (!draft.confirmation) return null;
  const recheck: boolean = draft.reviews.some((review): boolean => review.correctionId !== null && review.recheckState === "required");
  return <section className="result-next" aria-label="확정 후 다음 행동"><h3>확정 뒤 이어가기</h3>
    <p>{recheck ? "정정된 근거의 재검증이 남아 있어요. 복습 대상과 날짜를 먼저 확인해 주세요." : "확정한 수행 수준과 위의 다음 행동을 확인한 뒤, 복습 일정 또는 다음 학습 범위를 선택해 주세요."}</p>
    <div className="result-next-links"><a className="alter-focus" href="/learn/tutor#reviews"><strong>복습 제안·날짜 확인</strong><span>제안된 조건과 날짜를 확인해요. 시작 가능 여부는 복습 화면에서 안내해요.</span></a><a className="alter-focus" href="/learn/library#scope-setup"><strong>다음 학습 범위 고르기</strong><span>확정 계획의 단원과 자료를 직접 선택해요. 이 이동만으로 단원 통과나 수업 시작이 처리되지 않아요.</span></a></div>
    <a className="result-today-link alter-focus" href="/learn">오늘의 학습 현황으로</a>
  </section>;
}
