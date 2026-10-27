import type { ReactElement } from "react";
import { ActionButton } from "@/components/alter/action-button";

export type LibraryStep = "unit" | "material" | "range" | "time" | "review";
export type LibraryReadiness = Readonly<{ hasUnit: boolean; hasRange: boolean; hasLinks: boolean; hasRecord: boolean }>;
export const librarySteps: readonly Readonly<{ id: LibraryStep; label: string }>[] = [
  { id: "unit", label: "단원" }, { id: "material", label: "자료" }, { id: "range", label: "페이지·구간" }, { id: "time", label: "시간" }, { id: "review", label: "검토" },
];
function unavailableReason(step: LibraryStep, ready: LibraryReadiness): string | null {
  if (step === "unit") return null;
  if (!ready.hasUnit) return "확정 계획의 단원을 먼저 선택해 주세요.";
  if (step === "range" && !ready.hasRange && !ready.hasLinks) return "자료를 선택해 확인 구간을 읽어 주세요.";
  if (step === "time" && !ready.hasLinks) return "페이지·구간을 단원에 먼저 연결해 주세요.";
  if (step === "review" && !ready.hasRecord) return "비교할 구간과 시간을 저장하면 열 수 있어요.";
  return null;
}

/** 화면 이동은 선택과 입력을 유지하며 자료 연결·AI 비교·확정을 실행하지 않습니다. */
export function LibrarySteps({ step, ready, busy, onStep }: Readonly<{ step: LibraryStep; ready: LibraryReadiness; busy: boolean; onStep: (step: LibraryStep) => void }>): ReactElement {
  return <nav aria-label="오늘 범위 선택 단계"><ol className="library-steps">{librarySteps.map((item, index): ReactElement => {
    const reason: string | null = unavailableReason(item.id, ready);
    return <li key={item.id}><ActionButton id={`library-step-${item.id}`} type="button" tone={step === item.id ? "primary" : "secondary"} availability={busy ? { kind: "busy", reason: "요청 결과를 확인하고 있어요." } : reason === null ? { kind: "available" } : { kind: "blocked", reason }} aria-current={step === item.id ? "step" : undefined} onClick={(): void => onStep(item.id)}>{index + 1}. {item.label}</ActionButton></li>;
  })}</ol></nav>;
}
