"use client";

import { diagnosticFailure } from "@/lib/diagnostic-message";
import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import type { AiLedgerAcceptance } from "@/lib/ai/ledger-acceptance";

function checkedResult(value: unknown): AiLedgerAcceptance {
  if (typeof value !== "object" || value === null || !("status" in value) || value.status !== "passed" || !("cleanup" in value) || value.cleanup !== "passed" || !("providerEvidence" in value) || value.providerEvidence !== "synthetic-no-network" || !("paidCalls" in value) || value.paidCalls !== 0 || !("checks" in value) || !Array.isArray(value.checks) || !value.checks.every((item: unknown) => typeof item === "string")) throw new TypeError("AI 비용 검사 결과 형식이 올바르지 않습니다.");
  return value as AiLedgerAcceptance;
}
export function AiLedgerCheck(): ReactElement | null {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [message, setMessage] = useState<string>("AI를 호출하지 않고 임시 비용 기록을 검사한 뒤 정리합니다.");
  const [result, setResult] = useState<AiLedgerAcceptance | null>(null);
  const [pending, setPending] = useState<boolean>(false);
  const active = useRef<boolean>(false);
  async function check(): Promise<void> {
    if (active.current) return;
    active.current = true; setPending(true); setResult(null); setMessage("비용 보호 기능을 확인하고 있어요.");
    try {
      const response: Response = await fetch("/api/ai/ledger-check", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw diagnosticFailure(response.status);
      const data: AiLedgerAcceptance = checkedResult(await response.json());
      setResult(data); setMessage(`${data.checks.length}개 비용 검사를 통과했고 임시 기록을 정리했어요. AI 호출은 0회입니다.`);
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : "비용 검사 결과를 확인하지 못했어요."); }
    finally { active.current = false; setPending(false); }
  }
  if (!ready) return null;
  return <details className="storage-check"><summary>AI 비용 보호 확인</summary><button type="button" className="storage-check-button" onClick={check} disabled={pending}>{pending ? "비용 확인 중…" : "AI 비용 보호 검사"}</button><p role="status" aria-live="polite">{message}</p>{result !== null && <details><summary>비용 검사 결과 보기</summary><pre data-testid="ai-ledger-check-result" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(result, null, 2)}</pre></details>}</details>;
}
