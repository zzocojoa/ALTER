"use client";

import { diagnosticFailure } from "@/lib/diagnostic-message";
import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import type { DataAcceptance } from "@/lib/data-acceptance";

function checkedResult(value: unknown): DataAcceptance {
  if (typeof value !== "object" || value === null || !("status" in value) || value.status !== "passed" || !("cleanup" in value) || value.cleanup !== "passed" || !("checks" in value) || !Array.isArray(value.checks) || !value.checks.every((entry: unknown) => typeof entry === "string")) throw new TypeError("저장 검사 결과 형식이 올바르지 않습니다.");
  return value as DataAcceptance;
}

export function DataCheck(): ReactElement | null {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [message, setMessage] = useState<string>("임시 학습 기록으로 저장과 복구를 확인한 뒤 정리합니다.");
  const [result, setResult] = useState<DataAcceptance | null>(null);
  const [pending, setPending] = useState<boolean>(false);
  const active = useRef<boolean>(false);
  async function check(): Promise<void> {
    if (active.current) return;
    active.current = true; setPending(true); setResult(null); setMessage("학습 기록 저장을 확인하고 있어요.");
    try {
      const response: Response = await fetch("/api/storage/data-check", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw diagnosticFailure(response.status);
      const data: DataAcceptance = checkedResult(await response.json());
      setResult(data); setMessage(`${data.checks.length}개 저장 검사를 통과했고 임시 기록을 정리했어요.`);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "저장 검사 결과를 확인하지 못했어요.");
    } finally { active.current = false; setPending(false); }
  }
  if (!ready) return null;
  return <details className="storage-check"><summary>학습 기록 저장 확인</summary>
    <button type="button" className="storage-check-button" onClick={check} disabled={pending}>{pending ? "저장 확인 중…" : "학습 기록 저장 검사"}</button>
    <p role="status" aria-live="polite">{message}</p>
    {result !== null && <details><summary>검사 결과 보기</summary><pre data-testid="data-check-result" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(result, null, 2)}</pre></details>}
  </details>;
}
