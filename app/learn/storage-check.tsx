"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { StorageProbeResult } from "@/lib/storage-probe";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import { verifyPrivateFileAccess } from "@/lib/private-file-probe";

type CheckState = Readonly<{ kind: "idle" | "pending" | "success" | "error"; message: string }>;
const initialState: CheckState = { kind: "idle", message: "임시 검사 파일을 만들어 접근을 확인한 뒤 정리합니다." };


function isSuccessfulProbe(value: unknown): value is StorageProbeResult {
  return typeof value === "object" && value !== null
    && "database" in value && value.database === "passed"
    && "files" in value && value.files === "passed"
    && "cleanup" in value && value.cleanup === "passed";
}

function responseFailure(status: number): string {
  if (status === 401) return "로그인이 필요해요. 화면을 새로고침하고 로그인한 뒤 다시 확인해 주세요.";
  if (status === 403) return "저장소를 확인할 권한이 없어요. 소유자 계정으로 로그인했는지 확인해 주세요.";
  if (status === 503) return "지금은 저장소를 확인할 수 없어요. 잠시 후 다시 확인해 주세요.";
  return "저장소 연결을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.";
}

/** 기존 인증 API만 호출하며 검사 중 중복 실행과 오래된 응답의 상태 갱신을 막습니다. */
export function StorageCheck(): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [state, setState] = useState<CheckState>(initialState);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    function resetPending(): void {
      if (activeRequest.current === null) return;
      activeRequest.current.abort();
      activeRequest.current = null;
      setState(initialState);
    }
    function restorePage(event: PageTransitionEvent): void {
      if (event.persisted) resetPending();
    }
    window.addEventListener("pagehide", resetPending);
    window.addEventListener("pageshow", restorePage);
    return () => {
      window.removeEventListener("pagehide", resetPending);
      window.removeEventListener("pageshow", restorePage);
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, []);

  async function checkStorage(): Promise<void> {
    if (!ready || activeRequest.current !== null) return;
    const controller: AbortController = new AbortController();
    activeRequest.current = controller;
    setState({ kind: "pending", message: "저장소 연결을 확인하고 있어요. 잠시만 기다려 주세요." });
    const timeoutId: number = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const response: Response = await fetch("/api/storage/probe", {
        method: "POST", credentials: "same-origin", signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (activeRequest.current !== controller) return;
      if (!response.ok) {
        setState({ kind: "error", message: responseFailure(response.status) });
        return;
      }
      const result: unknown = await response.json();
      if (activeRequest.current !== controller) return;
      if (!isSuccessfulProbe(result)) {
        setState({ kind: "error", message: "검사 결과를 확인하지 못했어요. 다시 확인해 주세요." });
        return;
      }
      await verifyPrivateFileAccess(controller.signal);
      if (activeRequest.current !== controller) return;
      setState({ kind: "success", message: "저장소 연결을 확인했어요. 데이터베이스와 파일 저장소가 정상입니다." });
    } catch (error: unknown) {
      if (activeRequest.current !== controller) return;
      const message: string = controller.signal.aborted
        ? "검사 응답이 늦어 결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요."
        : error instanceof TypeError
          ? "네트워크 연결을 확인하고 다시 눌러 주세요."
          : error instanceof SyntaxError
            ? "검사 응답을 읽지 못했어요. 다시 확인해 주세요."
            : "파일 접근 또는 임시 파일 정리를 확인하지 못했어요. 다시 검사하기 전에 관리자에게 확인해 주세요.";
      console.warn({ event: "storage_check_response_failed", errorType: error instanceof Error ? error.name : "unknown" });
      setState({ kind: "error", message });
    } finally {
      window.clearTimeout(timeoutId);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  return <section className="storage-check" aria-label="저장소 연결 확인">
    <button type="button" className="storage-check-button" disabled={!ready || state.kind === "pending"}
      aria-describedby="storage-check-result" onClick={checkStorage}>
      {state.kind === "pending" ? "확인 중…" : state.kind === "error" ? "다시 확인하기" : "저장소 연결 확인"}
    </button>
    <p id="storage-check-result" className="storage-check-result" data-state={state.kind}
      role={state.kind === "error" ? "alert" : "status"} aria-atomic="true">{state.message}</p>
  </section>;
}
