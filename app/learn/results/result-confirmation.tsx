import type { ReactElement } from "react";
import { StatusBadge } from "@/components/alter/status";
import { ActionButton, type ActionAvailability } from "@/components/alter/action-button";
import type { ResultDraft } from "@/lib/results/contracts";

export function ResultState({ draft }: Readonly<{ draft: ResultDraft }>): ReactElement {
  return <section className="result-state" aria-label="결과 반영 상태"><StatusBadge label={draft.confirmation ? "공식 확정 기록" : draft.canConfirm ? "사용자 확정 전" : "확정 전 확인 필요"} tone={draft.confirmation ? "success" : draft.canConfirm ? "neutral" : "warning"}/>
    {draft.confirmation ? <p>사용자가 확인한 {draft.confirmation.version}판이에요. 확정 당시의 근거와 판단을 보관해요.</p> : <><p>종료 초안 · 아직 공식 기록에 반영되지 않았어요</p><p className="alter-caption">저장된 답안·도움 이력과 AI 진단으로 계산한 후보예요. 내용과 근거를 확인한 뒤 아래에서 직접 확정해 주세요.</p></>}
    {draft.issues.length > 0 && <div className="result-issues"><h3>먼저 확인할 근거</h3><ul>{draft.issues.map((issue): ReactElement => <li key={issue}>{issue}</li>)}</ul></div>}
  </section>;
}

type ConfirmationProps = Readonly<{ draft: ResultDraft; busy: boolean; uncertain: boolean; confirmIssue: string | null; onConfirm: () => Promise<void>; onRefresh: () => Promise<void> }>;
/** 확정 버튼은 명시적 조작만 받으며 후보 조회나 화면 복귀로 확정하지 않습니다. */
export function ResultConfirmation({ draft, busy, uncertain, confirmIssue, onConfirm, onRefresh }: ConfirmationProps): ReactElement {
  const availability: ActionAvailability = busy ? { kind: "busy", reason: "서버의 기록 응답을 기다리고 있어요." } : confirmIssue ? { kind: "blocked", reason: confirmIssue } : draft.confirmation ? { kind: "blocked", reason: "이 회차는 이미 공식 기록으로 확정됐어요." } : uncertain ? { kind: "available" } : !draft.canConfirm || draft.issues.length > 0 ? { kind: "blocked", reason: draft.issues[0] ?? "확정할 저장 근거가 아직 확인되지 않았어요. 서버 최신 기록을 확인해 주세요." } : { kind: "available" };
  return <section className="result-confirmation" aria-label="사용자 결과 확정"><h3>{draft.confirmation ? "확정된 기록 보관" : "내용 확인 후 직접 확정"}</h3><p>{draft.confirmation ? "다시 누르거나 새로고침해도 같은 회차의 확정 기록을 추가하지 않아요." : "확정하면 이 후보의 진도·수행 수준·다음 행동을 공식 기록에 반영해요. AI를 새로 호출하지 않아요."}</p>
    {uncertain && <p className="result-uncertain" role="status">처리 결과 미확인: 입력한 확정 요청을 보관하고 있어요. 같은 요청 확인 버튼으로 결과를 조회하세요.</p>}
    <div className="result-actions"><ActionButton id="result-confirm" type="button" tone="primary" availability={availability} onClick={(): void => { void onConfirm(); }}>{uncertain ? "같은 요청으로 확정 결과 확인" : "내용 확인 후 공식 기록 확정"}</ActionButton><ActionButton id="result-refresh" type="button" tone="secondary" availability={busy ? { kind: "busy", reason: "서버의 기록 응답을 기다리고 있어요." } : { kind: "available" }} onClick={(): void => { void onRefresh(); }}>서버 최신 기록 확인</ActionButton><a href={`${draft.editor ? "/learn/editor" : "/learn/tutor"}?id=${draft.id}`}>수업 기록으로 돌아가기</a></div>
  </section>;
}
