import type { ReactElement } from "react";
import { tutorHelpStage, type TutorHelpStage } from "@/lib/tutor/contracts";
import type { TutorView } from "@/lib/tutor/view";

export const tutorHelpLabels: Readonly<Record<TutorHelpStage, string>> = {
  direction: "방향", "small-question": "힌트", "similar-example": "부분 시범", "full-explanation": "정답 설명",
};

/** 저장한 단계만 표시하며 이전 도움 본문이나 원문을 다시 공개하지 않습니다. */
export function TutorHelpHistory({ history, questionId, originalExposure }: Readonly<{ originalExposure:TutorView["originalExposure"];history: TutorView["helpHistory"]; questionId: string }>): ReactElement {
  const current = history.filter((entry): boolean => entry.questionId === questionId);
  return <section className="tutor-help-history" aria-label="도움 단계와 사용 기록">
    <h3>도움 단계</h3>
    <p>현재 질문 {current.length}단계 · 이 회차의 도움 기록 {history.length}개</p>
    <ol className="tutor-help-steps" aria-label="현재 질문의 도움 단계">
      {tutorHelpStage.options.map((stage, index): ReactElement => {
        const used: boolean = current.some((entry): boolean => entry.stage === stage);
        return <li key={stage} data-used={used}><span>{index + 1}. {tutorHelpLabels[stage]}</span><small>{used ? "사용 기록 있음" : "아직 사용하지 않음"}</small></li>;
      })}
    </ol>
    <p className="tutor-field-hint">각 도움 뒤에 직접 답안을 쓰고 진단받은 다음, 다음 단계로 진행해요. 도움 기록이 없다는 표시만으로 독립 수행이 확정되지는 않아요.</p>
    <section aria-label="원본 열기 기록"><h4>원본 열기</h4>{originalExposure===null ? <p>원본 열기 이력은 아직 확인되지 않았어요. 0개나 무도움 수행으로 판단하지 않아요.</p> : <><p>현재 질문 {originalExposure.currentQuestionCount}개 · 이 회차 {originalExposure.sessionCount}개 기록</p><p className="tutor-field-hint">같은 원본의 반복 조회는 하나로 기록해요. 원본을 연 문제의 도움 기록은 유지되며, 독립 수행은 저장 답안·자료 가림·새 조건 과제 근거를 함께 확인해 확정해요.</p></>}</section>
    {history.length > 0 && <ol className="tutor-help-records" aria-label="이 회차의 누적 도움 기록">{history.map((entry): ReactElement => <li key={entry.id}>{entry.questionId === questionId ? "현재 질문" : "이전 질문"} · {tutorHelpLabels[entry.stage]}<small>도움 사용 저장됨 · 화면 수신 확인과 별도</small></li>)}</ol>}
  </section>;
}
