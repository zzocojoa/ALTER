import type { ReactElement } from "react";
import type { ResultDraft } from "@/lib/results/contracts";
import { canonicalJson } from "@/lib/domain/contracts";

/** 과거 확정 판단은 그대로 두고 이후 정정과 현재 후보를 별도 영역으로 표시합니다. */
export function ResultRecheck({ draft }: Readonly<{ draft: ResultDraft }>): ReactElement | null {
  const corrected = draft.reviews.filter((review): boolean => review.correctionId !== null);
  const changed: boolean = draft.confirmation !== null && (canonicalJson(draft.confirmation.judgment) !== canonicalJson(draft.judgment) || draft.latest?.id !== draft.confirmation.id || draft.issues.length > 0);
  if (!draft.confirmation && !draft.latest && corrected.length === 0) return null;
  return <section className="result-recheck" aria-label="확정 이력과 재검토"><h3>확정 당시와 현재 상태</h3>
    {draft.confirmation && <div className="result-frozen"><h4>이 회차의 확정 당시 · {draft.confirmation.version}판</h4><p>{new Date(draft.confirmation.confirmedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 서울 시간</p><p>진도 {draft.confirmation.judgment.progress} · 수행 {draft.confirmation.judgment.performance}</p><p className="alter-caption">당시의 판단과 근거를 보존해요. 이후 정정이 이 기록을 덮어쓰지 않아요.</p></div>}
    {draft.latest && <div><h4>단원의 최신 공식 기록 · {draft.latest.version}판</h4><p>진도 {draft.latest.progress} · 수행 {draft.latest.performance}</p>{draft.latest.correctionId && <p>정정이 연결된 공식 기록이에요.</p>}{draft.confirmation && draft.latest.id !== draft.confirmation.id && <p>지금 보고 있는 회차보다 뒤에 확정한 다른 기록이에요.</p>}</div>}
    {changed && <div className="result-issues"><h4>현재 근거로 다시 확인한 후보</h4><p>진도 {draft.judgment.progress} · 수행 {draft.judgment.performance}</p><p>위의 과거 확정과 구분해요. 새 답안과 현재 기준으로 확인하기 전에는 재검증 완료가 아니에요.</p></div>}
    {corrected.length > 0 && <div><h4>정정 후 재검토</h4><ul>{corrected.map((review): ReactElement => <li key={review.id}><p>{review.nextAction}</p><p className="alter-caption">복습 기록 {review.version}판 · {review.recheckState === "required" ? "재검증 필요" : review.recheckState === "delayed" ? "지연 재현 확인 기록" : "현재 저장 상태 확인 필요"}</p></li>)}</ul></div>}
  </section>;
}
