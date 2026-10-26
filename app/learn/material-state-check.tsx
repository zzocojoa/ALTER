"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import type { MaterialStateAcceptance } from "@/lib/materials/state-acceptance";

function checkedResult(value: unknown): MaterialStateAcceptance {
  if (typeof value !== "object" || value === null || !("status" in value) || value.status !== "passed" || !("cleanup" in value) || value.cleanup !== "passed" || !("realR2Writes" in value) || value.realR2Writes !== 0 || !("checks" in value) || !Array.isArray(value.checks) || !value.checks.every((entry: unknown): boolean => typeof entry === "string")) throw new TypeError("자료 상태 검사 결과 형식이 올바르지 않습니다.");
  return value as MaterialStateAcceptance;
}

export function MaterialStateCheck(): ReactElement | null {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [message, setMessage] = useState<string>("임시 기록으로 업로드 중단·중복 요청·용량 예약을 확인합니다. 원본 파일은 전송하지 않아요.");
  const [result, setResult] = useState<MaterialStateAcceptance | null>(null);
  const [pending, setPending] = useState<boolean>(false);
  const active = useRef<boolean>(false);
  async function check(): Promise<void> {
    if (active.current) return;
    active.current = true; setPending(true); setResult(null); setMessage("자료 저장 상태를 확인하고 있어요.");
    try {
      const response: Response = await fetch("/api/storage/material-state-check", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`자료 상태 검사 응답 HTTP ${response.status}. 로그인 상태와 서버 검사 기록을 확인해 주세요.`);
      const data: MaterialStateAcceptance = checkedResult(await response.json());
      setResult(data); setMessage(`${data.checks.length}개 자료 상태 검사를 통과했고 임시 기록을 정리했어요.`);
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : "자료 상태 검사 결과를 확인하지 못했어요."); }
    finally { active.current = false; setPending(false); }
  }
  if (!ready) return null;
  return <details className="storage-check"><summary>자료 저장 상태 확인</summary>
    <button type="button" className="storage-check-button" onClick={check} disabled={pending}>{pending ? "자료 상태 확인 중…" : "자료 저장 상태 검사"}</button>
    <p role="status" aria-live="polite">{message}</p>
    {result !== null && <details><summary>자료 상태 검사 결과</summary><pre data-testid="material-state-result" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(result, null, 2)}</pre></details>}
  </details>;
}
