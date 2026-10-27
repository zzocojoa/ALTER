import type { ExternalWorkflowState, ExternalOperationState } from "../external/state";
import type { StatusTone } from "./save-status";

export type GoogleTransferPresentation = Readonly<{ label: string; detail: string; tone: StatusTone }>;
export const googleTransferPresentations: Readonly<Record<ExternalWorkflowState, GoogleTransferPresentation>> = {
  pending: { label: "전송 대기", detail: "ALTER에 요청을 보관했어요. Google 내용 확인은 아직 완료되지 않았어요.", tone: "neutral" },
  running: { label: "전송·확인 진행 중", detail: "아직 Google의 최종 내용을 확인하지 못했어요.", tone: "neutral" },
  partial: { label: "일부 단계만 확인됨", detail: "확인되지 않은 단계가 남아 있어 전체 저장 완료가 아니에요.", tone: "warning" },
  confirmed: { label: "Google에서 확인됨", detail: "저장할 내용을 Google에서 다시 읽어 일치함을 확인했어요.", tone: "success" },
  failed: { label: "전송 또는 확인 실패", detail: "완료로 처리하지 않았어요. 같은 작업의 상태를 이어서 확인해 주세요.", tone: "danger" },
  unknown: { label: "전송 결과 불명", detail: "전송 성공 여부를 단정할 수 없어요. 새 작업을 중복 생성하지 말고 같은 작업의 결과를 확인해 주세요.", tone: "warning" },
  conflict: { label: "Google 내용 충돌", detail: "직접 변경한 내용과 저장된 요청이 달라요. Google의 현재 내용을 확인해 주세요. 자동으로 덮어쓰지 않아요.", tone: "warning" },
};
export const googleOperationLabels: Readonly<Record<ExternalOperationState, string>> = { pending: "대기", running: "진행 중", received: "응답 받음 · 내용 검증 전", confirmed: "내용 확인됨", failed: "실패", unknown: "결과 불명", conflict: "내용 충돌" };
