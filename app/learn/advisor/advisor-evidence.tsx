import type { ReactElement } from "react";
import type { AdvisorState } from "@/lib/advisor/contracts";
import { StatusBadge } from "@/components/alter/status";

const phaseLabels: Readonly<Record<AdvisorState["phase"], string>> = { diagnosis: "진단 진행 중", planning: "계획 초안 준비", draft: "계획 검토 필요", confirmed: "계획 확정 저장됨" };

/** 서버에서 읽은 진단 기록과 학습 수행의 미확인을 서로 다른 상태로 표시합니다. */
export function AdvisorRecordSummary({ state }: Readonly<{ state: AdvisorState }>): ReactElement {
  return <aside className="advisor-record-summary" aria-label="저장된 진단 상태">
    <div className="advisor-record-badges"><StatusBadge label={phaseLabels[state.phase]} tone={state.phase === "confirmed" ? "success" : "neutral"} /><StatusBadge label={`답변 ${state.answers.length}개 저장됨`} tone="neutral" />{state.pending !== null && <StatusBadge label="AI 처리 결과 확인 필요" tone="warning" />}</div>
    <p>마지막으로 읽은 서버 기록 {state.version}판 · 한 번에 질문 하나 · 진단 질문 최대 6개</p>
    <p>{state.question === null ? "현재 작성 중인 질문은 없어요." : `현재 ${state.answers.length + 1}번째 질문에 답하는 중이에요.`} 답변 저장·AI 초기 추정·계획 확정은 서로 다른 단계예요.</p>
    <p className="advisor-note">진단만으로 자기 설명·독립 수행·지연 재현을 통과 처리하지 않아요.</p>
  </aside>;
}

export function AdvisorEvidence({ state }: Readonly<{ state: AdvisorState }>): ReactElement {
  if (state.answers.length === 0) return <p className="advisor-note">아직 제출한 답변이 없어요. 입력 중인 글은 답변 저장 전까지 진단 근거에 포함하지 않아요.</p>;
  return <details className="advisor-evidence"><summary>제출한 답변과 도움 사용 기록 ({state.answers.length})</summary>
    <p>사용자가 제출한 답변과 도움 사용 기록을 AI의 해석과 구분해 보여요. 이곳의 내용은 저장된 기록이며 입력 중인 초안이 아니에요.</p>
    {state.answers.map((answer, index): ReactElement => {
      const estimates = state.estimates.filter((estimate): boolean => estimate.answerId === answer.id);
      return <article key={answer.id} className="advisor-evidence-answer" aria-label={`${index + 1}번째 제출 답변`}>
        <h3>{index + 1}. {answer.mode === "explanation" ? "설명 답변" : "수행 답변"}</h3>
        <StatusBadge label="답변 제출 저장됨" tone="success" /><p className="advisor-pre" aria-label="제출한 답변 본문">{answer.text}</p>
        <section aria-label="신고한 도움 사용"><h4>사용한 도움 · 사용자 신고</h4><dl className="advisor-evidence-help"><div><dt>자료 참고</dt><dd>{answer.materialUsed ? "사용함" : "사용 안 함"}</dd></div><div><dt>힌트·다른 사람</dt><dd>{answer.hintUsed ? "사용함" : "사용 안 함"}</dd></div><div><dt>답안 노출</dt><dd>{answer.answerSeen ? "보았음" : "보지 않음"}</dd></div></dl><p className="advisor-note">도움을 쓰지 않았다는 신고만으로 독립 수행을 확정하지 않아요.</p></section>
        {estimates.length === 0 ? <section className="advisor-evidence-estimate" aria-label="AI 초기 추정"><StatusBadge label="저장된 AI 추정 없음" tone="warning" /><p>답변은 저장됐지만 이 답변의 AI 해석은 아직 기록되지 않았어요. 학습 수행 수준은 미확인입니다.</p></section> : estimates.map((estimate): ReactElement => <section className="advisor-evidence-estimate" aria-label="AI 초기 추정" key={estimate.answerId}>
          <h4>AI 초기 추정</h4><StatusBadge label="초기 계획의 참고 · 통과 판정 아님" tone="warning" /><p className="advisor-pre">{estimate.interpretation}</p><h5>답변에서 인용한 근거</h5><blockquote className="advisor-pre">{estimate.quote}</blockquote>
          <div className="advisor-evidence-unverified"><h5>아직 확인하지 못한 항목</h5>{estimate.unverified.length > 0 ? <ul>{estimate.unverified.map((item, itemIndex): ReactElement => <li key={itemIndex}>{item}</li>)}</ul> : <p>구체적인 항목이 기록되지 않았어요. 독립 수행·지연 재현의 확인을 뜻하지 않아요.</p>}</div>
        </section>)}
      </article>;
    })}
  </details>;
}
