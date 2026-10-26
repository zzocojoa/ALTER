"use client";
import { useState } from "react";
import type { ReactElement } from "react";
import type { GoogleConnectionView } from "@/lib/google/view";
import { googleConnectionCanUseData } from "@/lib/google/view";

const steps: readonly string[] = ["docs-create", "docs-write", "sheets-create", "sheets-write", "calendar-create", "calendar-write", "verify", "refresh"];
export function GoogleAcceptanceClient({ connection }: Readonly<{ connection: GoogleConnectionView["connection"] }>): ReactElement {
  const [busy, setBusy] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (): Promise<void> => {
    if (!connection) return;
    setBusy(true); setMessage(null);
    try {
      for (const [index, step] of steps.entries()) {
        setMessage(`고정 시험 ${index + 1}/${steps.length} 확인 중…`);
        const response: Response = await fetch("/api/google/acceptance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: connection.connectionId, generation: connection.generation, step }), cache: "no-store" });
        const result: unknown = await response.json();
        if (!response.ok) { setMessage(`고정 시험 ${index + 1}에서 중단했어요. ${typeof result === "object" && result !== null && "message" in result && typeof result.message === "string" ? result.message : "연결과 요청 기록을 확인해 주세요."}`); return; }
      }
      setMessage("고정 시험 통과: 문서 본문·성과표 셀·전용 캘린더 일정을 실제로 다시 읽고 연결 갱신까지 확인했어요.");
    } catch (error: unknown) { if (error instanceof Error) setMessage("시험 응답을 확인하지 못했어요. 저장된 요청 상태를 먼저 확인해 주세요."); else throw error; }
    finally { setBusy(false); }
  };
  return <section className="storage-check" aria-label="Google 고정 시험"><h2>Task 14 Google API 검증</h2><p>자체 작성 시험 문서·성과표·전용 캘린더를 하나씩 만들고 내용을 다시 확인해요. AI를 호출하지 않아요.</p><button className="storage-check-button" disabled={busy || !googleConnectionCanUseData(connection)} onClick={() => { void run(); }}>{busy ? "검증 중…" : "고정 Google API 검증"}</button>{message && <p role="status">{message}</p>}</section>;
}
