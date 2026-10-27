import type { ReactElement } from "react";

export type UploadPhase = "idle" | "invalid" | "checking" | "reserving" | "transferring" | "confirming" | "confirmed" | "attention";
const steps: readonly Readonly<{ phase: UploadPhase; label: string }>[] = [{ phase: "idle", label: "파일 선택" }, { phase: "checking", label: "파일 검사" }, { phase: "reserving", label: "공간 예약" }, { phase: "transferring", label: "원본 전송" }, { phase: "confirming", label: "등록 확인" }];
const descriptions: Readonly<Record<UploadPhase, string>> = { idle: "파일을 선택한 뒤 등록을 눌러 주세요.", invalid: "입력을 확인해 주세요. 원본 전송은 시작하지 않았어요.", checking: "파일 형식·크기와 원본 해시를 확인하고 있어요.", reserving: "서버에서 저장 공간 예약을 확인하고 있어요.", transferring: "원본을 전송하고 있어요. 아직 등록 완료가 아니에요.", confirming: "서버에서 원본 내용과 등록 결과를 확인하고 있어요.", confirmed: "서버에서 원본 등록을 확인했어요. AI 추출 확인은 별도로 진행해요.", attention: "등록 완료를 확인하지 못했어요. 입력을 유지하고 아래 안내에 따라 상태를 확인해 주세요." };

/** 시간이나 전송 바이트로 완료를 추정하지 않고 실제 응답 단계만 표시합니다. */
export function UploadProgress({ phase }: Readonly<{ phase: UploadPhase }>): ReactElement {
  return <section className="alter-upload-progress" aria-label="자료 등록 단계" data-phase={phase}>
    <ol>{steps.map((step): ReactElement => <li key={step.phase} aria-current={phase === step.phase ? "step" : undefined}>{step.label}</li>)}</ol>
    <p role="status" aria-live="polite" aria-atomic="true">{descriptions[phase]}</p>
  </section>;
}
