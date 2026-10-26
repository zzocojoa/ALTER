"use client";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import { prepareLibrarianAcceptance } from "./prepare-acceptance";
import { librarianJson, scopeViewReply } from "./client-api";
import { LIBRARIAN_ACCEPTANCE_ID, LIBRARIAN_HELP_ACCEPTANCE_ID } from "@/lib/librarian/acceptance-fixture";
import type { ScopeView } from "./client-api";
export function LibrarianAcceptanceCheck(): ReactElement {
  const [id,setId] = useState<string>(LIBRARIAN_ACCEPTANCE_ID);
  const ready = useSyncExternalStore(subscribeToHydration,clientReady,serverReady);
  const [view,setView] = useState<ScopeView | null>(null); const [busy,setBusy] = useState<boolean>(false); const [error,setError] = useState<string>("");
  async function prepare(): Promise<void> { setBusy(true); setError(""); try { setView(await prepareLibrarianAcceptance(id)); } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); } finally { setBusy(false); } }
  async function compare(): Promise<void> { if (!view) return; setBusy(true); setError(""); try { setView(scopeViewReply.parse(await librarianJson("/api/librarian/acceptance",{ method: "POST",headers: { "content-type": "application/json" },body: JSON.stringify({ id, expectedVersion: view.scope.version }) }))); } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); } finally { setBusy(false); } }
  return <details className="storage-check" inert={!ready}><summary>Task 8 고정 자료 검증</summary><p>승인된 자체 작성 분수 자료만 준비합니다. AI 비교는 Task 4·6·7과 모든 재시도를 합친 기존 승인된 누적 검증 한도 안에서 실행하며 추가 충전은 없습니다. 원화 대사는 미확정입니다.</p><p><a href="/learn?check=budget#check-budget">현재 검증 한도와 누적 사용량 확인</a></p><label>검증 범위<select value={id} disabled={busy} onChange={(event):void=>{setId(event.target.value);setView(null);setError("");}}><option value={LIBRARIAN_ACCEPTANCE_ID}>기존 자료 검증</option><option value={LIBRARIAN_HELP_ACCEPTANCE_ID}>네 단계 도움용 새 범위</option></select></label><button disabled={busy || !ready} onClick={(): void => { void prepare(); }}>시험 자료 준비·저장 상태 확인</button>{view && <><p role="status">시험 범위 기록 {view.scope.version}판 · {view.scope.phase}</p>{["linked","evaluating"].includes(view.scope.phase) && <button disabled={busy || !ready} onClick={(): void => { void compare(); }}>{view.scope.pendingKey ? "기존 시험 AI 결과 확인" : "고정 시험 자료 AI 비교"}</button>}<p>결과를 검토하고 확정하려면 새로고침한 뒤 위의 학습 범위 기록을 확인해 주세요.</p></>}{error && <p role="alert">{error}</p>}</details>;
}
