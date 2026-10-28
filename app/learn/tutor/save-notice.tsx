import type { ReactElement } from "react";
import type { SaveState } from "@/lib/ui/save-status";
import { SaveStatus, StatusBadge } from "@/components/alter/status";

export function TutorSaveNotice({ state, submitting, pendingAi }: Readonly<{ state: SaveState; submitting: boolean; pendingAi: boolean }>): ReactElement {
  return <div className="tutor-save-notice">
    {submitting ? <div id="tutor-draft-status" role="status" data-persistence="unconfirmed"><StatusBadge label="답안을 제출하고 있어요" tone="neutral"/><p className="alter-caption">서버 응답을 기다리고 있어요. 아직 제출 완료가 아니에요.</p></div> : <SaveStatus id="tutor-draft-status" state={state}/>}
    {pendingAi && <p><StatusBadge label="AI 결과 확인 대기" tone="warning"/><span className="alter-caption"> 답안 저장과 AI 처리는 별도예요.</span></p>}
  </div>;
}
