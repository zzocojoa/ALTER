"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import type { AiSupportProbeReport } from "@/lib/ai/support-probe";

function checkedReport(value: unknown): AiSupportProbeReport {
  if (typeof value !== "object" || value === null || !("status" in value) || value.status !== "passed" || !("environment" in value) || value.environment !== "hosted-worker" || !("checks" in value) || !Array.isArray(value.checks) || value.checks.length !== 4 || !("observations" in value) || !Array.isArray(value.observations)) throw new TypeError("AI 연결 검사 결과 형식이 올바르지 않습니다.");
  return value as AiSupportProbeReport;
}

export function AiSupportCheck(): ReactElement | null {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [message, setMessage] = useState<string>("텍스트·이미지·응답 형식과 연결 중단을 확인합니다. OpenAI API 비용이 발생하며 기존 월 예산에 포함됩니다.");
  const [pending, setPending] = useState<boolean>(false);
  const [result, setResult] = useState<AiSupportProbeReport | null>(null);
  const active = useRef<boolean>(false);
  async function check(): Promise<void> {
    if (active.current) return;
    active.current = true; setPending(true); setResult(null); setMessage("AI 연결을 확인하고 있어요.");
    try {
      const response: Response = await fetch("/api/ai/support-check", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      const data: unknown = await response.json();
      if (!response.ok) {
        const code: string = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : "unknown_error";
        if (code === "ai_configuration_required" || code === "ai_key_required") throw new Error("AI 운영 설정이 준비되지 않아 호출하지 않았어요. 결제·예산·키 설정을 완료한 뒤 확인해 주세요.");
        const details: string = typeof data === "object" && data !== null ? Object.entries(data).filter(([key, value]): boolean => ["stage", "category", "providerStatus", "providerCode", "providerParam", "providerRequestId", "operation", "hasWhitespace", "hasAssignmentPrefix", "hasQuotes", "hasProjectKeyPrefix"].includes(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")).map(([key, value]): string => `${key}: ${String(value)}`).join(" · ") : "";
        throw new Error(`AI 연결 검사 HTTP ${response.status} (${code}). ${details}`);
      }
      const report: AiSupportProbeReport = checkedReport(data);
      setResult(report); setMessage("4개 연결 검사를 통과했어요. 사용량 계산액과 미정산 예약은 비용 기록에 보존됩니다.");
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : "AI 연결 검사 결과를 확인하지 못했어요."); }
    finally { active.current = false; setPending(false); }
  }
  if (!ready) return null;
  return <details className="storage-check"><summary>AI 연결 확인</summary><p role="status" aria-live="polite">{message}</p><button type="button" className="storage-check-button" onClick={check} disabled={pending}>{pending ? "AI 연결 확인 중…" : "AI 연결 검사 (API 비용 발생)"}</button>{result !== null && <details><summary>AI 연결 결과 보기</summary><pre data-testid="ai-support-check-result" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(result, null, 2)}</pre></details>}</details>;
}
