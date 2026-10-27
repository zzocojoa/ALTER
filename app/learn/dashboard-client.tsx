"use client";
import { EmptyState, ErrorState, LoadingState } from "@/components/alter/status";
import { DashboardMetrics } from "./dashboard-metrics";
import { DashboardShortcuts } from "./dashboard-shortcuts";
import { NavigationCheck } from "./navigation-check";
import { CheckTarget } from "./check-target";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { dashboardIsStale, learningDashboard } from "@/lib/dashboard/contracts";
import type { LearningDashboard } from "@/lib/dashboard/contracts";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";

const phaseLabels = { explanation: "교재 살펴보기", "awaiting-answer": "답안 작성", "answer-saved": "답안 저장됨", evaluating: "진단 결과 확인", diagnosed: "진단 확인·다음 단계", finished: "회차 종료", paused: "잠시 멈춤" } as const;
const reviewLabels = { proposed: "일정 수락 필요", today: "오늘 복습", overdue: "기한 지난 복습", recheck: "정정 후 재확인" } as const;
const scopeLabels = { linked: "범위 검토 전", evaluating: "검토 중", proposed: "확정 전", confirmed: "확정" } as const;
export function LearningDashboardClient(): ReactElement {
  const [data, setData] = useState<LearningDashboard | null>(null);
  const [busy, setBusy] = useState<boolean>(true);
  const [stale, setStale] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setData(null);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`학습 기록을 읽지 못했어요 (HTTP ${response.status}). 로그인·저장소 상태를 확인하고 다시 읽어 주세요.`);
      const next = learningDashboard.parse(await response.json());
      if (controller.signal.aborted) return;
      setData(next); setStale(dashboardIsStale(next.asOf, Date.now()));
    } catch (cause: unknown) {
      if (controller.signal.aborted) return;
      if (!(cause instanceof Error)) throw cause;
      setError(cause.message);
    } finally { if (request.current === controller) setBusy(false); }
  }, []);
  useEffect(() => {
    let needsRecheck: boolean = false;
    function hide(): void { needsRecheck = true; request.current?.abort(); setData(null); setStale(true); }
    function show(): void { if (document.visibilityState === "visible") { needsRecheck = false; void refresh(); } }
    function restored(event: PageTransitionEvent): void { if (event.persisted || needsRecheck) show(); }
    function visibility(): void { if (document.visibilityState === "hidden") hide(); else show(); }
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", restored); window.addEventListener(RECALL_START_EVENT, hide); document.addEventListener("visibilitychange", visibility);
    return () => { window.clearTimeout(initialLoad); request.current?.abort(); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", restored); window.removeEventListener(RECALL_START_EVENT, hide); document.removeEventListener("visibilitychange", visibility); };
  }, [refresh]);
  useEffect(() => { if (!data) return; const timer = window.setInterval(() => setStale(dashboardIsStale(data.asOf, Date.now())), 10_000); return () => window.clearInterval(timer); }, [data]);
  return <section data-alter-ui className="learning-dashboard" aria-label="오늘의 학습 현황" aria-busy={busy}>
    <div className="dashboard-heading"><h2 className="alter-subheading">오늘 이어갈 학습</h2><button type="button" className="alter-control" disabled={busy} onClick={() => void refresh()}>최신 현황 읽기</button></div>
    {busy && <LoadingState label="서울 날짜와 저장된 학습 기록을 확인하고 있어요." />}
    {error && <ErrorState title="현재 학습 기록을 읽지 못했어요" detail={`${error} 조회 실패는 ‘할 일 없음’을 뜻하지 않아요.`} action={null} />}
    {stale && !busy && <p className="dashboard-stale" role="status">조회한 지 시간이 지났거나 화면을 떠났어요. 최신 현황을 다시 읽어 주세요.</p>}
    {data && !stale && <>
      <NavigationCheck data={data}/>
      <p>{data.today} · 서울 날짜 · <time dateTime={new Date(data.asOf).toISOString()}>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }).format(data.asOf)}</time> 확인</p>
      {data.visibility === "hidden-recall" && <p role="status">자료를 가린 인출 연습 중이에요. 범위·복습 내용·다음 행동은 가리고 진행 중인 회차로 이어가요.</p>}
      <DashboardShortcuts data={data} />
      {data.visibility === "visible" && data.sessions.length === 0 && data.scopes.length === 0 && data.results.length === 0 && data.reviews.length === 0 && data.legacyReviews === 0 ? <EmptyState title="이어갈 학습이 아직 없어요" detail="학습할 자료를 준비하고 진단과 계획에서 오늘의 범위를 정해 보세요. 이미 등록한 자료도 그대로 사용할 수 있어요." action={<div className="dashboard-empty-actions"><a className="alter-link" href="/learn/materials">자료 등록·확인</a><a className="alter-link" href="/learn/advisor">진단과 계획 만들기</a><a className="alter-link" href="/learn/library">오늘 범위 정하기</a></div>} /> : null}
      <section aria-label="진행 중 회차"><h3>진행 중 회차</h3>{data.sessions.length === 0 ? <p>진행 중인 회차가 없어요.</p> : data.sessions.map(session => <article key={session.id}><p>{session.course}</p><h4>{session.title}</h4><p>{session.kind === "editor" ? "결과물 개선" : session.kind === "review" ? "복습 회차" : "한 걸음 수업"} · {phaseLabels[session.phase]}</p><a href={`/learn/${session.kind === "editor" ? "editor" : "tutor"}?id=${session.id}`}>이 회차 이어가기</a></article>)}</section>
      {data.visibility === "visible" && <>

        <CheckTarget id="check-progress" instruction="① 아래에서 ‘이 복습 확인하기’, 진도 ‘완료’, 수행 수준 ‘독립 수행’이 보이는지 확인해 주세요."><section aria-label="복습과 재확인"><h3>복습과 재확인</h3>{data.reviews.length === 0 && data.legacyReviews === 0 ? <p>현재 도래했거나 수락을 기다리는 복습이 없어요.</p> : <>{data.reviews.map(review => <article key={review.id}><h4>{review.title}</h4><p>{reviewLabels[review.dueState]} · {review.dueDate}</p><a href={review.sessionId ? `/learn/tutor?id=${review.sessionId}` : `/learn/tutor#review-${review.id}`}>이 복습 확인하기</a></article>)}{data.legacyReviews > 0 && <p><a href="/learn/tutor">이전 확정 결과 {data.legacyReviews}개의 복습 제안 확인</a></p>}</>}</section>
        <section aria-label="확정된 진도와 다음 행동"><h3>확정된 진도와 다음 행동</h3><p>진도와 실제 수행 수준은 따로 기록해요. 최근 확정 결과를 그대로 표시해요.</p>{data.results.length === 0 ? <p>아직 확정된 학습 결과가 없어요.</p> : data.results.map(result => <article key={result.record.unitId}><p>{result.course}</p><h4>{result.title}</h4><dl><dt>진도</dt><dd>{result.record.progress}</dd><dt>수행 수준</dt><dd>{result.record.performance}</dd><dt>다음 행동</dt><dd>{result.record.nextAction ?? "저장된 다음 행동이 없어요. 결과를 확인해 주세요."}</dd></dl><a href={result.sessionId ? `/learn/results?id=${result.sessionId}` : "/learn/results"}>확정 결과 확인하기</a></article>)}</section></CheckTarget>
        <section aria-label="오늘의 범위"><h3>오늘의 범위</h3>{data.scopes.length === 0 ? <p>오늘 날짜로 저장한 학습 범위가 없어요. <a href="/learn/library">범위 정하기</a></p> : data.scopes.map(scope => <article key={scope.id}><p>{scope.course}</p><h4>{scope.title}</h4><p>{scopeLabels[scope.phase]} · {scope.minutes}분 · 기록 {scope.version}판</p>{!scope.current && <p>계획·원문·확정 결과가 바뀌어 범위를 다시 확인해야 해요.</p>}<a href={`/learn/library?id=${scope.id}`}>이 범위 확인하기</a></article>)}</section>
        <DashboardMetrics data={data} />
      </>}
    </>}
  </section>;
}
