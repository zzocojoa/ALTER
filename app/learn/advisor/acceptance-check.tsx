"use client";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { advisorState } from "@/lib/advisor/contracts";
import type { AdvisorState } from "@/lib/advisor/contracts";
import { z } from "zod";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";

export function AdvisorAcceptanceCheck(): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [state, setState] = useState<AdvisorState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  async function advance(): Promise<void> {
    setBusy(true); setError("");
    try {
      const response: Response = await fetch("/api/advisor/acceptance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(state ? { action: "advance", expectedVersion: state.version } : { action: "start" }) });
      const raw: unknown = await response.json();
      if (!response.ok) { const failure = z.object({ error: z.string(), message: z.string().optional() }).parse(raw); throw new Error(`${failure.message ?? "시험 검증을 완료하지 못했어요."} (${failure.error})`); }
      setState(z.object({ session: advisorState }).parse(raw).session);
    } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); }
    finally { setBusy(false); }
  }
  return <details className="advisor-acceptance"><summary>고정 시험으로 Advisor 검증</summary><p>시험용 분수 학습 조건과 고정 답변만 사용합니다. 기존 Task 4·6 비용과 재시도를 합쳐 승인된 누적 검증 한도를 넘지 않으며, 추가 충전은 하지 않습니다. 실제 사용자 학습계획과 구분해 보관합니다.</p><p><a href="/learn?check=budget#check-budget">현재 검증 한도와 누적 사용량 확인</a></p><p>최대 6개 질문과 계획 초안을 검증합니다. 이 버튼은 단계마다 한 번 진행하며 AI 호출 단계에서는 기존 API 크레딧을 사용합니다.</p>{state && <p role="status">시험 {state.version}판 · {state.phase} · 답변 {state.answers.length}개{state.question ? ` · ${state.question.prompt}` : ""}</p>}{error && <p role="alert">{error}</p>}<button type="button" disabled={!ready || busy || state?.phase === "draft" || state?.phase === "confirmed"} onClick={(): void => { void advance(); }}>{busy ? "시험 진행 중" : !state ? "고정 시험 기록 열기" : state.question ? "고정 시험 답변 저장" : "고정 시험 다음 단계"}</button>{state?.draft && <p><a href="/learn/advisor">검증 초안 검토 화면 열기</a></p>}</details>;
}
