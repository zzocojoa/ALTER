import type { ReactElement } from "react";
import { StatusBadge } from "@/components/alter/status";
import type { ExternalWorkflowView } from "@/lib/external/resume";
import { googleTransferPresentations } from "@/lib/ui/google-transfer";
import type { GoogleTransferPresentation } from "@/lib/ui/google-transfer";

/** 외부 작업의 저장 상태만 설명하며 조회나 렌더링으로 전송을 시작하지 않습니다. */
export function CalendarTransfer({ workflow }: Readonly<{ workflow: ExternalWorkflowView }>): ReactElement {
  const view: GoogleTransferPresentation = googleTransferPresentations[workflow.state];
  return <section className="calendar-transfer" aria-label="Google 전송 상태"><h3>Google 전송 상태</h3><StatusBadge label={view.label} tone={view.tone}/><p>{view.detail}</p><p>확인된 단계 {workflow.operations.filter(operation => operation.state === "confirmed").length} / {workflow.operations.length}</p><p>ALTER의 복습 수락·학습 완료·지연 재현 판정과는 별도예요.</p></section>;
}
