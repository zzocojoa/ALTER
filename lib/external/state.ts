import { z } from "zod";

export const externalOperationState = z.enum(["pending", "running", "received", "confirmed", "failed", "unknown", "conflict"]);
export type ExternalOperationState = z.infer<typeof externalOperationState>;
export const externalWorkflowState = z.enum(["pending", "running", "partial", "confirmed", "failed", "unknown", "conflict"]);
export type ExternalWorkflowState = z.infer<typeof externalWorkflowState>;
export const externalEvent = z.enum(["claim-write", "claim-verification", "claim-conflict-verification", "write-response", "content-matched", "content-conflicted", "result-unresolved", "provider-failed", "lease-expired", "nonexecution-proven"]);
export type ExternalEvent = z.infer<typeof externalEvent>;
export type ExternalTransitionFailure = Error & Readonly<{ code: "external_transition_denied"; state: ExternalOperationState; event: ExternalEvent }>;
const transitions: Readonly<Record<ExternalOperationState, Readonly<Partial<Record<ExternalEvent, ExternalOperationState>>>>> = {
  pending: { "claim-write": "running", "claim-verification": "running" },
  running: { "nonexecution-proven": "pending", "write-response": "received", "content-matched": "confirmed", "content-conflicted": "conflict", "result-unresolved": "unknown", "provider-failed": "failed", "lease-expired": "unknown" },
  received: { "claim-verification": "running" },
  unknown: { "claim-verification": "running" },
  failed: { "claim-verification": "running" },
  confirmed: {},
  conflict: { "claim-conflict-verification": "running" },
};

/** 전송 의도 이후에는 쓰기 실행권을 다시 주지 않고 별도의 내용 확인으로만 재개합니다. */
export function transitionExternalOperation(state: ExternalOperationState, event: ExternalEvent): ExternalOperationState {
  externalOperationState.parse(state); externalEvent.parse(event);
  const next: ExternalOperationState | undefined = transitions[state][event];
  if (!next) throw Object.assign(new Error("외부 작업의 현재 상태에서는 이 전이를 실행할 수 없어요."), { name: "ExternalTransitionFailure", code: "external_transition_denied" as const, state, event });
  return next;
}

/** 응답 수신·부분 성공·실패는 전체 확인 완료로 집계하지 않습니다. */
export function summarizeExternalOperations(states: readonly ExternalOperationState[]): ExternalWorkflowState {
  z.array(externalOperationState).min(1).max(40).parse(states);
  if (states.every(state => state === "confirmed")) return "confirmed";
  if (states.includes("conflict")) return "conflict";
  if (states.includes("unknown")) return "unknown";
  if (states.includes("failed")) return "failed";
  if (states.some(state => state === "running" || state === "received")) return "running";
  return states.includes("confirmed") ? "partial" : "pending";
}
