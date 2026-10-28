import type { ReactElement } from "react";
import { StatusBadge } from "@/components/alter/status";
import type { WeeklyAggregate, WeeklyAnswerEvidence } from "@/lib/weekly/evidence";
import type { WeeklyClaim } from "@/lib/weekly/claims";
import type { StatusTone } from "@/lib/ui/save-status";

type EvidenceGroup = "independent" | "helped" | "recheck" | "unverified";
const groups: readonly Readonly<{ id: EvidenceGroup; label: string; tone: StatusTone }>[] = [
  { id: "independent", label: "독립 수행 근거 확인", tone: "success" }, { id: "helped", label: "도움 사용 기록", tone: "neutral" }, { id: "recheck", label: "근거 재검증 필요", tone: "warning" }, { id: "unverified", label: "독립 수행 미확인", tone: "neutral" },
];
function evidenceGroup(answer: WeeklyAnswerEvidence): EvidenceGroup {
  if (answer.needsRecheck) return "recheck";
  if (answer.helped) return "helped";
  return answer.accepted ? "independent" : "unverified";
}

/** 공식 답안의 저장된 판정만 분류하며 원문 확인·자기 보고를 독립 수행으로 올리지 않습니다. */
export function WeeklyEvidence({ aggregate, covered }: Readonly<{ aggregate: WeeklyAggregate; covered: boolean }>): ReactElement {
  const counts = aggregate.counts;
  return <section className="weekly-evidence" aria-label="실제 수행 근거"><h3>실제 수행 근거</h3><p>확정 회차 {counts.sessions}개 · 실제 답안 {counts.answers}개</p>{counts.sessions === 0 && <p>이 주에는 확정된 학습 기록이 없어요. 성과로 합산하지 않아요.</p>}
    <dl className="weekly-counts"><div><dt>새 조건 독립 수행</dt><dd>{counts.independentNewConditions}</dd></div><div><dt>자기 말로 독립 설명</dt><dd>{counts.independentExplanations}</dd></div><div><dt>도움 사용 답안</dt><dd>{counts.helpedAnswers}</dd></div><div><dt>확인된 오답</dt><dd>{counts.incorrectAnswers}</dd></div><div><dt>지연 재현 확인</dt><dd>{counts.delayedRecall}</dd></div><div><dt>첨삭 개선 확인</dt><dd>{counts.editorImprovements}</dd></div></dl>
    <p className="alter-caption">항목은 서로 겹칠 수 있어요. 도움 사용·첨삭 개선은 독립 수행과 별도로 집계해요.</p>
    {!covered && <details><summary>성과의 근거 · 실제 제출 답안 ({aggregate.answers.length})</summary>{groups.map(group => <section key={group.id} aria-label={group.label} className="weekly-evidence-group"><h4><StatusBadge label={group.label} tone={group.tone}/></h4>{aggregate.answers.filter(answer => evidenceGroup(answer) === group.id).map(answer => <article className="weekly-item" id={`weekly-answer-${answer.id}`} key={answer.id}><h5>{answer.unitTitle}</h5><p>{answer.prompt}</p><blockquote>{answer.text}</blockquote><p>{answer.helped ? "도움 사용" : "도움 사용 없음"} · {answer.needsRecheck ? "근거 재검증 필요" : answer.accepted ? "독립 수행 근거 확인" : "독립 수행 미확인"}</p><p>{answer.observation}</p><a href={`/learn/tutor?id=${answer.sessionId}`}>이 답안의 수업 회차 열기</a><p>확정 결과 {answer.resultOrdinal}판 · 답안 {answer.answerVersion}판</p></article>)}{!aggregate.answers.some(answer => evidenceGroup(answer) === group.id) && <p>해당 답안이 없어요.</p>}</section>)}</details>}
  </section>;
}

export function WeeklyClaimChoices({ catalog, selected }: Readonly<{ catalog: readonly WeeklyClaim[]; selected: readonly string[] }>): ReactElement {
  const independentKinds: readonly WeeklyClaim["kind"][] = ["independent-new-condition", "independent-explanation", "correction-recheck", "delayed-recall"];
  const categories = [{ label: "독립 수행·지연 재현", claims: catalog.filter(claim => independentKinds.includes(claim.kind)) }, { label: "도움·오답·첨삭 기록", claims: catalog.filter(claim => !independentKinds.includes(claim.kind)) }];
  return <>{categories.map(category => <section className="weekly-claim-group" key={category.label} aria-label={category.label}><h4>{category.label}</h4>{category.claims.length === 0 ? <p>확정 답안으로 뒷받침되는 성과가 없어요.</p> : category.claims.map(claim => <label className="weekly-check" key={claim.id}><input type="checkbox" name="claims" value={claim.id} defaultChecked={selected.includes(claim.id)}/><span>{claim.content} <a href={`#weekly-answer-${claim.answerId}`}>근거 답안 보기</a></span></label>)}</section>)}</>;
}
