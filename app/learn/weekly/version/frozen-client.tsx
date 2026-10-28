"use client";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { WeeklyAnalogyReading } from "../weekly-analogy";
import { WeeklyTime } from "../weekly-time";
import { PageHeader } from "@/components/alter/page-header";
import { StatusBadge } from "@/components/alter/status";
import { weeklyFrozen, type WeeklyFrozen } from "@/lib/weekly/view";
import { requireWeeklyFrozenReply, weeklyExportPresentation } from "@/lib/weekly/frozen-view";
import { allocateWeeklyProposal } from "@/lib/weekly/planning";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";

export function WeeklyFrozenClient({ initial }: Readonly<{ initial: WeeklyFrozen }>): ReactElement {
  requireWeeklyFrozenReply(initial, initial);
  const [frozen, setFrozen] = useState<WeeklyFrozen>(initial);
  const [covered, setCovered] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const concealed = useRef<boolean>(false);
  const generation = useRef<number>(0);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const reading: number = ++generation.current;
    concealed.current = true; setCovered(true); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/weekly?version=${initial.state.confirmedVersionId}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`확정본 조회 실패 (HTTP ${response.status}). 로그인과 인출 상태를 확인해 주세요.`);
      const next: WeeklyFrozen = weeklyFrozen.parse(await response.json());
      if (controller.signal.aborted || reading !== generation.current) return;
      requireWeeklyFrozenReply(initial, next);
      setFrozen(next); concealed.current = false; setCovered(false);
    } catch (cause: unknown) {
      if (controller.signal.aborted || reading !== generation.current) return;
      if (!(cause instanceof Error)) throw cause;
      setError(cause.message);
    } finally { if (reading === generation.current) { request.current = null; setBusy(false); } }
  }, [initial]);
  useEffect(() => {
    function hide(): void { request.current?.abort(); generation.current += 1; concealed.current = true; setCovered(true); setBusy(false); }
    function show(): void { if (concealed.current && document.visibilityState === "visible") void refresh(); }
    function visibility(): void { if (document.visibilityState === "hidden") hide(); else show(); }
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); window.addEventListener(RECALL_START_EVENT, hide); document.addEventListener("visibilitychange", visibility);
    return (): void => { request.current?.abort(); generation.current += 1; window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); window.removeEventListener(RECALL_START_EVENT, hide); document.removeEventListener("visibilitychange", visibility); };
  }, [refresh]);
  if (covered) return <main id="learn-main" tabIndex={-1} className="site-shell"><PageHeader title="주간 확정본 확인" context="기록 · 접근 재확인" back={{ href: "/learn/weekly", label: "주간 점검으로" }} action={null}/><p>로그인과 현재 근거를 다시 확인하고 있어요.</p>{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={(): void => { void refresh(); }}>다시 확인</button></main>;
  const state = frozen.state; const proposal = state.proposal;
  if (!proposal) throw new Error("저장된 주간 확정본의 제안이 없습니다.");
  const allocation = allocateWeeklyProposal(proposal, state.context);
  const exported = weeklyExportPresentation(frozen.exportState);
  return <main id="learn-main" tabIndex={-1} className="site-shell weekly-workspace">
    <PageHeader title={`${state.context.aggregate.period.start} 주간 확정본`} context="기록 · 주간 확정본" back={{ href: `/learn/weekly?id=${state.id}`, label: "현재 주간 점검으로" }} action={null}/>
    <section className="weekly-frozen-status" aria-label="확정본 보관 상태"><StatusBadge label={`읽기 전용 · 확정 기록 ${state.version}판`} tone="success"/><p><time dateTime={new Date(frozen.confirmedAt).toISOString()}>{new Date(frozen.confirmedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</time> 서울 시간에 확정했어요.</p><p>이 확정본은 수정하지 않아요. 새 초안은 현재 주간 점검에서 검토하고 별도 판으로 확정해요.</p><StatusBadge label={exported.label} tone={exported.tone}/><p>외부 연동 상태와 ALTER 내부 확정본 보관은 별도예요.</p>{!frozen.current && <p role="alert">현재 근거와 달라 재검증이 필요한 이전 확정본이에요. 당시 기록을 그대로 표시해요.</p>}{frozen.issue && <p role="alert">{frozen.issue}</p>}<button disabled={busy} onClick={(): void => { void refresh(); }}>확정본 접근·연동 상태 다시 확인</button></section>
    <section className="weekly-section"><h2>확정한 성과</h2>{state.claims.length === 0 ? <p>선택한 확정 성과가 없어요.</p> : state.claims.map(claim => <p key={claim.id}>{claim.content} · <a href={`/learn/tutor?id=${claim.sessionId}`}>근거 답안 회차</a> · 결과 {claim.resultOrdinal}판</p>)}</section>
    <section className="weekly-section"><h2>다음 주 계획</h2><WeeklyTime allocation={allocation} units={state.context.units}/>{allocation.items.map((entry, index) => <article key={index} className="weekly-item"><p>{entry.status === "assigned" ? "배정" : "미배정"} · {entry.item.activity} · 예상 {entry.item.estimatedMinutes}분 · 배정 {entry.allocatedMinutes}분</p><p>{entry.reason}</p></article>)}</section>
    <section className="weekly-section"><h2>Roommate · 내용 설명</h2><p>선택 원문 확인은 독립 수행이나 모든 상황의 사실성을 보증하지 않아요.</p>{proposal.roommate.facts.map((fact, index) => <article className="weekly-item" key={index}><StatusBadge label={fact.status === "source-checked" ? "선택 원문에서 확인" : "미확인 설명"} tone={fact.status === "source-checked" ? "neutral" : "warning"}/><p>{fact.content}</p>{fact.quote && <blockquote>{fact.quote}</blockquote>}</article>)}</section>
    <WeeklyAnalogyReading analogy={proposal.roommate.analogy}/>
    <section className="weekly-section"><h2>내 메모 · 자기 보고</h2><p className="weekly-note">{state.notes || "남긴 메모가 없어요."}</p><h3>미확인 사항과 예상의 한계</h3><ul>{proposal.uncertainty.map((text, index) => <li key={index}>{text}</li>)}</ul></section>
  </main>;
}
