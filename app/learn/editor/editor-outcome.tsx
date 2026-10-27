import type { ReactElement } from "react";
import type { EditorView } from "@/lib/editor/view";

/** 수정본 평가와 새 조건의 답안을 구분하며 확정 수행 수준을 추정하지 않습니다. */
export function EditorOutcome({ view }: Readonly<{ view: EditorView }>): ReactElement {
  const review = view.reviews.at(-1);
  const invalid: boolean = view.feedbacks.some((item): boolean => item.needsRecheck) || view.reviews.some((item): boolean => item.needsRecheck) || !view.tutor.current;
  const improvement: string = invalid ? "원문·기준 재확인 필요" : review ? review.outcome === "ready-for-recheck" ? "제출한 수정본의 개선 확인" : "추가 수정 필요" : "수정본 평가 기록 없음";
  const transfer: string = view.transfer?.candidate ? "무도움 수행 근거 후보 · 확정 전" : view.transfer ? "답안 기록 있음 · 무도움 성공 미확정" : view.historyHidden ? "새 조건 수행 중 · 이전 평가 가림" : "새 조건 수행 근거 미확인";
  return <section className="editor-outcome" aria-label="개선 평가와 독립 수행 구분"><h2>{view.tutor.phase === "finished" ? "보관된 첨삭 결과" : "평가와 수행 상태"}</h2><dl><div><dt>수정본 평가</dt><dd>{view.historyHidden ? "이전 평가 가림" : improvement}</dd></div><div><dt>새 조건의 직접 수행</dt><dd>{invalid ? "기준 재확인 필요 · 수행 확정 전" : transfer}</dd></div></dl><p>개선 평가·도움 사용·새 조건 수행은 따로 기록해요. 이 화면의 저장이나 종료만으로 독립 수행이 확정되지 않아요.</p>{view.tutor.pending && <p>이미 요청한 AI 결과가 확인 대기 중이에요. 저장한 초안과 비용 이력은 유지돼요.</p>}{view.tutor.phase === "finished" && <a href={`/learn/results?id=${view.tutor.id}`}>이 첨삭의 결과 확인·확정으로 이동</a>}</section>;
}
