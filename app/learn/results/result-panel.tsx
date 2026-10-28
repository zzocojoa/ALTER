import { ResultNext } from "./result-next";
import { ResultRecheck } from "./result-recheck";
import { ResultEvidenceCard } from "./result-evidence";
import { ResultState, ResultConfirmation } from "./result-confirmation";
import { ResultSummary } from "./result-summary";
import type { ReactElement } from "react";
import type { ResultDraft } from "@/lib/results/contracts";

export function ResultPanel({draft,busy,uncertain,confirmIssue,error,onConfirm,onRefresh}:Readonly<{draft:ResultDraft;busy:boolean;uncertain:boolean;confirmIssue:string|null;error:string;onConfirm:()=>Promise<void>;onRefresh:()=>Promise<void>}>):ReactElement {
  const judgment=draft.confirmation?.judgment ?? draft.judgment;
  return <article className="result-card" aria-busy={busy}><ResultState draft={draft}/><h2>{draft.title}</h2><p className="result-version">서버에 저장된 회차 {draft.version}판</p><ResultSummary draft={draft}/><ResultEvidenceCard key={`${draft.fingerprint}:explanation`} resultId={draft.id} fingerprint={draft.fingerprint} value={judgment.explanation} label="자료 없이 핵심 설명"/><ResultEvidenceCard key={`${draft.fingerprint}:variation`} resultId={draft.id} fingerprint={draft.fingerprint} value={judgment.variation} label="새 조건 과제의 독립 수행"/>{draft.errors.length>0 && <section><h3>다시 확인할 내용</h3><ul>{draft.errors.map((item,index)=><li key={index}>{item}</li>)}</ul></section>}<ResultRecheck draft={draft}/>{draft.reviews.length>0 && <section><h3>현재 복습 대상</h3><ul>{draft.reviews.map((review)=><li key={review.id}>{review.nextAction} · {review.version}판{review.correctionId ? " · 정정 후 재확인" : ""}</li>)}</ul></section>}<details><summary>전체 평가 근거 ({judgment.evidence.length})</summary>{judgment.evidence.map((value)=><ResultEvidenceCard key={`${draft.fingerprint}:${value.sessionId}:${value.answerId}`} resultId={draft.id} fingerprint={draft.fingerprint} value={value} label={value.kind==="self-explanation" ? "설명 답안" : "변형 답안"}/>)}</details>{error && <p role="alert">{error}</p>}<ResultConfirmation draft={draft} busy={busy} uncertain={uncertain} confirmIssue={confirmIssue} onConfirm={onConfirm} onRefresh={onRefresh}/><ResultNext draft={draft}/></article>;
}
