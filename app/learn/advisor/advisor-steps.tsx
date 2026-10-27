import type { ReactElement } from "react";
import type { AdvisorState } from "@/lib/advisor/contracts";
import { ActionButton } from "@/components/alter/action-button";

export type AdvisorStep = "conditions" | "questions" | "answer" | "plan" | "confirmation";
export const advisorSteps: readonly Readonly<{ id: AdvisorStep; label: string }>[] = [
  { id: "conditions", label: "학습 조건" }, { id: "questions", label: "질문" }, { id: "answer", label: "답변" }, { id: "plan", label: "계획 검토" }, { id: "confirmation", label: "확정" },
];

/** 저장된 진단 상태로 다음 화면만 정하며 질문 생성·계획 확정을 실행하지 않습니다. */
export function currentAdvisorStep(state: AdvisorState | null): AdvisorStep {
  if (state === null) return "conditions";
  if (state.phase === "confirmed") return "confirmation";
  if (state.draft !== null) return "plan";
  return state.question === null ? "questions" : "answer";
}

export function advisorStepReason(step: AdvisorStep, state: AdvisorState | null): string | null {
  if (step === "conditions") return null;
  if (state === null) return "학습 조건을 먼저 저장해 주세요.";
  if (step === "answer" && state.question === null && state.answers.length === 0) return "첫 진단 질문을 받은 뒤 열 수 있어요.";
  if ((step === "plan" || step === "confirmation") && state.draft === null) return "진단 후 계획 초안을 만들면 열 수 있어요.";
  return null;
}

export function AdvisorSteps({ step, state, busy, onStep }: Readonly<{ step: AdvisorStep; state: AdvisorState | null; busy: boolean; onStep: (step: AdvisorStep) => void }>): ReactElement {
  return <nav aria-label="진단과 계획 단계"><ol className="advisor-steps">{advisorSteps.map((item, index): ReactElement => {
    const reason: string | null = advisorStepReason(item.id, state);
    return <li key={item.id}><ActionButton id={`advisor-step-${item.id}`} type="button" tone={step === item.id ? "primary" : "secondary"} aria-current={step === item.id ? "step" : undefined} availability={busy ? { kind: "busy", reason: "저장 응답을 확인하고 있어요." } : reason === null ? { kind: "available" } : { kind: "blocked", reason }} onClick={(): void => onStep(item.id)}>{index + 1}. {item.label}</ActionButton></li>;
  })}</ol></nav>;
}
