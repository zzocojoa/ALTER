"use client";
import { StorageUsage } from "./storage-usage";
import { FundingDetails } from "./funding-details";
import { formatUsageWon as won, formatUsageTime as when, formatUsageMiB as mib } from "./usage-format";
import { ServiceAvailability } from "./service-availability";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { usageDashboard } from "@/lib/dashboard/usage";
import type { UsageDashboard } from "@/lib/dashboard/usage";
import { dashboardIsStale } from "@/lib/dashboard/contracts";

const states: Readonly<Record<string, string>> = { active: "연결됨", partial: "일부 반영·일부 권한", refreshing: "인증 갱신 중", "refresh-unknown": "인증 갱신 결과 불명", reconsent: "재동의 필요", disconnecting: "연결 해제 중", disconnected: "연결 해제됨", pending: "대기", running: "처리 중", received: "응답 수신·재조회 대기", confirmed: "재조회 확인 완료", failed: "실패", unknown: "결과 불명", conflict: "외부 내용 충돌" };
export function UsageDetails({ data, observedAt }: Readonly<{ data: UsageDashboard; observedAt: number }>): ReactElement {
  const pricing = data.ai.pricing;
  return <div className="usage-details"><p>기준 {when(data.asOf)} · 저장된 원장과 관측값. 이 조회는 AI·Google API를 호출하지 않아요.</p>
    {data.restoration !== null && <p role="status">복원한 학습 기록이에요. 아래 소비·예약·작업 이력은 과거 기록이며, 현재 사용 가능한 AI 예산과 Google 사용량은 미확인이에요. 현재 원장 대사 전에는 AI·Google 호출과 기존 작업 재실행을 차단해요.</p>}
    <ServiceAvailability data={data} observedAt={observedAt}/><section aria-label="AI 예산과 결제"><h3>AI 예산과 결제</h3><p>{data.ai.model} · AI 월 7,000원 · 추가 운영비 월 10,000원 · 기존 ChatGPT 구독료는 별도예요.</p><p>원장의 원화 소비는 저장된 가격·환산 계수로 계산한 값이며 카드사의 최종 청구액과 달라요.</p>
      {data.ai.configuration !== "configured" && <p>AI 설정 {data.ai.configuration === "missing" ? "미등록" : data.ai.configuration === "owner-mismatch" ? "소유자 불일치" : "검증 실패"}. 기존 원장은 아래에 보관돼요.</p>}
      {data.ai.windows.length === 0 ? <p>이번 달 원장이 아직 없어요. 사용 가능 잔액을 0원으로 판정하지 않아요.</p> : data.ai.windows.map(window => <article key={window.category}><h4>{window.category === "ai" ? "AI 소비 원장" : "기타 운영 소비 원장"}</h4><dl><dt>확정 소비</dt><dd>{won(window.settled)}</dd><dt>예약액</dt><dd>{won(window.reserved)} · 결과 불명 포함 {won(window.unknown)}</dd><dt>{data.restoration === null ? "앱 예산 잔여" : "과거 원장 잔여 · 현재 사용 가능액 미확인"}</dt><dd>{won(window.remaining)} / {won(window.limit)}</dd><dt>기간</dt><dd>{when(window.periodStart)} ~ {when(window.resetAt)}</dd></dl></article>)}
      <FundingDetails funding={data.ai.funding} probeCommitted={data.ai.probeCommittedUsdMicros} observedAt={observedAt} restoration={data.restoration}/>
      {pricing && <details><summary>적용 가격·환율 설정</summary><p>가격 버전 {pricing.id} · 확인 {when(pricing.pricing.provenance.checkedAt)} · 유효 {when(pricing.pricing.provenance.validUntil)}까지</p><p>100만 토큰당 입력 US${pricing.pricing.short.input} · 출력 US${pricing.pricing.short.output} · 캐시 읽기 US${pricing.pricing.short.cachedInput}</p><p>긴 문맥 입력 US${pricing.pricing.long.input} · 출력 US${pricing.pricing.long.output}</p><p>{pricing.purpose === "prepaid-probe" ? "실제 환율이 아닌 검증 예산 계수" : "적용 환율"}: USD당 {pricing.exchange.krwPerUsd}원 · 세금 계수 {pricing.tax.multiplier} · 수수료 계수 {pricing.fee.multiplier}</p><p>계산된 원화 소비와 카드사의 최종 청구액은 별도예요.</p><a href={pricing.pricing.provenance.source} target="_blank" rel="noreferrer">가격 근거</a><details><summary>보관된 가격 버전 {data.ai.pricingHistory.length}개</summary>{data.ai.pricingHistory.map(item => <p key={item.id}>{item.id} · {when(item.pricing.provenance.checkedAt)} · 입력 {item.pricing.short.input} / 출력 {item.pricing.short.output} USD · 환산 {item.exchange.krwPerUsd}원</p>)}</details></details>}
    </section>
    <section aria-label="Google 연결과 사용량"><h3>Google 연결과 사용량</h3>{data.google.connection ? <p>{data.google.connection.email} · {states[data.google.connection.state] ?? data.google.connection.state} · 선택·생성 파일 {data.google.connection.filesAllowed ? "허용" : "미승인"} · ALTER 캘린더 {data.google.connection.calendarAllowed ? "허용" : "미승인"}{data.google.connection.refreshExpiresAt !== null && ` · 인증 갱신 유효 ${when(data.google.connection.refreshExpiresAt)}까지`}</p> : <p>Google 연결 없음</p>}<a href="/learn/google">Google 연결과 재동의 관리</a><p>Google 직접 API 조건은 AI 예산과 별개예요. 초기 설정·재시도·검증 조회도 아래 집계에 포함해요.</p>
      {data.google.blocks.map((block, index) => <p key={index}>제공사 제한: {block.api} · {block.reason} · {block.until === null ? "해제 시각 미확인" : when(block.until)}</p>)}
      <details><summary>메서드별 실제 요청과 예약 ({data.google.methods.length})</summary>{data.google.methods.length === 0 && <p>저장된 요청 기록이 없어요.</p>}<div className="usage-table" tabIndex={0} role="region" aria-label="Google 메서드 사용량 표"><table><thead><tr><th scope="col">메서드</th><th scope="col">예약</th><th scope="col">전송</th><th scope="col">성공</th><th scope="col">실패</th><th scope="col">대기·불명</th></tr></thead><tbody>{data.google.methods.map(method => <tr key={`${method.projectId}:${method.method}`}><th scope="row">{method.method}<small>{method.projectId}</small></th><td>{method.reservations}</td><td>{method.method === "picker.open" ? "SDK 조회 수 미확인" : method.sent}</td><td>{method.succeeded}</td><td>{method.failed}</td><td>{method.unknown}</td></tr>)}</tbody></table></div></details>
      <p>Picker 실제 Google 쿼리 수는 미확인이에요. 앱의 열기 세션 수와 분리해요.</p>
      {data.google.pickerLimits.map(limit => <article key={limit.projectId}><h4>Picker · {limit.projectId}</h4><p>앱 세션: 프로젝트 {limit.projectCharged} / 분당 {limit.projectSessionsPerMinute}, 사용자 {limit.userCharged ?? "미확인"} / 분당 {limit.userSessionsPerMinute} · 안전 여유를 포함한 최근 2분을 집계해요.</p><p>제공사 사용자당 분당 {limit.queriesPerMinutePerUser}쿼리 · 실제 쿼리 수 미확인 · 관측 {when(limit.checkedAt)} · {limit.current ? "확인 기간 내" : "관측 만료"}</p><a href={limit.source} target="_blank" rel="noreferrer">Picker 한도 근거</a></article>)}
      <details><summary>서비스별 앱 제한·제공사 한도 ({data.google.limits.length})</summary>{data.google.limits.length === 0 && <p>한도 관측 근거 미확인</p>}{data.google.limits.map(limit => <article key={`${limit.projectId}:${limit.api}:${limit.metric}:${limit.scope}`}><h4>{limit.api} · {limit.metric} · {limit.scope === "project" ? "프로젝트" : "사용자"}</h4><p>앱 집계 {limit.appCharged ?? "미확인"} + 콘솔 관측 상한 {limit.consoleUpper} / 앱 제한 {limit.appLimit} · 제공사 한도 {limit.providerLimit} {limit.unit}</p><p>{limit.current ? "확인 기간 내" : "확인 기간 만료"} · 관측 {when(limit.checkedAt)} · 정책 {limit.policyVersion}판</p><a href={limit.source} target="_blank" rel="noreferrer">한도 출처</a></article>)}</details>
      {data.google.storage ? <p>Google 계정 저장 공간: 관측 사용 {mib(data.google.storage.usedBytes)} + 이후 예약 상한 {mib(data.google.storage.reservedBytes)} / {mib(data.google.storage.limitBytes)} · {when(data.google.storage.checkedAt)} · {data.google.storage.current ? "확인 기간 내" : "관측 만료·재확인 필요"}</p> : <p>Google 계정 저장 공간 미확인</p>}
    </section>
    <StorageUsage material={data.platform.material} observedAt={observedAt}/>
    <section aria-label="외부 작업별 반영 상태"><h3>외부 작업별 반영 상태</h3>{data.workflows.length === 0 ? <p>저장된 외부 작업이 없어요.</p> : data.workflows.map(workflow => <details key={workflow.id}><summary>{workflow.kind} · {states[workflow.state]} · {when(workflow.createdAt)}</summary><p>작업 {workflow.id}</p>{data.operations.filter(operation => operation.workflowId === workflow.id).map(operation => <p key={operation.id}>{operation.kind} · {states[operation.state]} · 기록된 시도 {operation.attempts}회</p>)}</details>)}<p>결과 불명·부분 반영은 완료로 표시하지 않아요. 이 화면은 외부 쓰기를 재실행하지 않아요.</p></section>
  </div>;
}
export function UsageDashboardClient(): ReactElement {
  const [data, setData] = useState<UsageDashboard | null>(null); const [error, setError] = useState<string>(""); const [busy, setBusy] = useState<boolean>(true); const [stale, setStale] = useState<boolean>(false);
  const [observedAt, setObservedAt] = useState<number>(0);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setData(null); setBusy(true); setError("");
    try { const response = await fetch("/api/dashboard/usage", { cache: "no-store", signal: controller.signal }); if (!response.ok) throw new Error(`사용량 원장 조회 실패 (HTTP ${response.status}). 미확인 값을 0으로 계산하지 않아요.`); const next = usageDashboard.parse(await response.json()); if (!controller.signal.aborted) { setData(next); setObservedAt(Date.now()); setStale(dashboardIsStale(next.asOf, Date.now())); } }
    catch (cause: unknown) { if (controller.signal.aborted) return; if (!(cause instanceof Error)) throw cause; setError(cause.message); }
    finally { if (request.current === controller) setBusy(false); }
  }, []);
  useEffect(() => {
    let concealed: boolean = document.visibilityState === "hidden";
    function hide(): void { concealed = true; request.current?.abort(); setData(null); }
    function show(): void { if (document.visibilityState !== "visible" || !concealed) return; concealed = false; void refresh(); }
    function visibility(): void { if (document.visibilityState === "hidden") hide(); else show(); }
    const timer: number = window.setTimeout(() => { if (!concealed) void refresh(); }, 0);
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show); document.addEventListener("visibilitychange", visibility);
    return (): void => { window.clearTimeout(timer); request.current?.abort(); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); document.removeEventListener("visibilitychange", visibility); };
  }, [refresh]);
  useEffect(() => { if (!data) return; const timer = window.setInterval(() => { const now = Date.now(); setObservedAt(now); setStale(dashboardIsStale(data.asOf, now)); }, 10_000); return () => window.clearInterval(timer); }, [data]);
  return <section className="learning-dashboard" aria-label="사용량과 서비스 상태" aria-busy={busy}><div className="dashboard-heading"><h2>사용량과 서비스 상태</h2><button disabled={busy} onClick={() => void refresh()}>사용량 원장 새로 읽기</button></div>{busy && <p role="status">저장된 원장 확인 중</p>}{error && <p role="alert">{error}</p>}{data && stale && !busy && <p role="status">이 사용량은 이전 조회 결과예요. 실행 전 최신 원장을 다시 읽어 주세요.</p>}{data && <UsageDetails data={data} observedAt={observedAt}/>}</section>;
}
