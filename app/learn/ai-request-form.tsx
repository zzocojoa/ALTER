"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { usageDashboard, type UsageDashboard } from "@/lib/dashboard/usage";
import type { AiCapability } from "@/lib/ai/support";
import { aiRequestIssues } from "@/lib/ui/ai-availability";
import { librarianJson } from "./library/client-api";
import { ActionButton, type ActionAvailability } from "@/components/alter/action-button";

const textCapabilities: readonly AiCapability[] = ["text", "structured-output", "usage", "output-limit"];
const imageCapabilities: readonly AiCapability[] = ["text", "image", "structured-output", "usage", "output-limit"];

export function AiRequestForm({ id, label, transmission, photoCount, availability, onRequest }: Readonly<{ id: string; label: string; transmission: string; photoCount: number; availability: ActionAvailability; onRequest: () => void }>): ReactElement {
  const [data, setData] = useState<UsageDashboard | null>(null);
  const [reading, setReading] = useState<boolean>(false);
  const [failure, setFailure] = useState<string>("");
  const [consented, setConsented] = useState<boolean>(false);
  const [now, setNow] = useState<number>(0);
  const active = useRef<AbortController | null>(null);
  const dispatching = useRef<boolean>(false);
  const required: readonly AiCapability[] = photoCount > 0 ? imageCapabilities : textCapabilities;
  const issues: readonly string[] = aiRequestIssues(data, required, now);
  useEffect((): (() => void) => {
    const timer = window.setInterval((): void => setNow(Date.now()), 10_000);
    return (): void => { window.clearInterval(timer); active.current?.abort(); };
  }, []);
  async function readConditions(): Promise<void> {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setReading(true); setData(null); setConsented(false); setFailure("");
    try {
      const next = usageDashboard.parse(await librarianJson("/api/dashboard/usage", { method: "GET", signal: controller.signal }));
      if (!controller.signal.aborted) { setData(next); setNow(Date.now()); }
    } catch (error: unknown) { if (!(error instanceof Error)) throw error; if (!controller.signal.aborted) setFailure("비용·지원 상태 조회 실패. " + error.message); }
    finally { if (active.current === controller) setReading(false); }
  }
  const allowed: ActionAvailability = availability.kind !== "available" ? availability : reading ? { kind: "busy", reason: "비용·지원 상태를 읽고 있어요." } : issues.length > 0 ? { kind: "blocked", reason: issues[0] } : !consented ? { kind: "blocked", reason: "위 전송 내용을 확인하고 동의해 주세요." } : { kind: "available" };
  const submit = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (availability.kind !== "available" || reading || !consented || dispatching.current) return;
    dispatching.current = true;
    const controller = new AbortController(); active.current = controller; setReading(true); setFailure("");
    try {
      const latest = usageDashboard.parse(await librarianJson("/api/dashboard/usage", { method: "GET", signal: controller.signal }));
      if (controller.signal.aborted) return;
      const checkedAt: number = Date.now(); const currentIssues = aiRequestIssues(latest, required, checkedAt);
      setData(latest); setNow(checkedAt);
      if (currentIssues.length > 0) { setConsented(false); setFailure(currentIssues.join(" ")); return; }
      onRequest();
    } catch (error: unknown) { if (!(error instanceof Error)) throw error; if (!controller.signal.aborted) { setData(null); setConsented(false); setFailure("전송 직전 조건 확인에 실패했어요. " + error.message); } }
    finally { dispatching.current = false; if (active.current === controller) setReading(false); }
  }, [availability, reading, consented, required, onRequest]);
  const funding = data?.ai.funding;
  return <form className="tutor-ai-action" data-ai-intent="new" aria-label={`${label} 전송 조건`} onSubmit={submit}>
    <h3>새 AI 요청 · 전송 내용 확인</h3>
    <p>{transmission} 사진은 제출한 답안에 등록된 {photoCount}장이 대상이에요.</p>
    <p className="tutor-field-hint">사진은 장당 2MiB·합계 4MiB 이내만 AI에 보내요. 단원 전체 파일이나 다른 회차의 답안을 임의로 추가하지 않아요.</p>
    <button type="button" disabled={reading || availability.kind === "busy"} onClick={(): void => { void readConditions(); }}>{reading ? "비용·지원 상태 확인 중…" : "비용·지원 상태 확인"}</button>
    {data && <div className="tutor-ai-cost"><p>저장된 원장 기준 · 실제 청구액과 별도</p>{funding?.probeLimitUsdMicros != null ? <><p>승인된 누적 한도 US${(funding.probeLimitUsdMicros / 1_000_000).toFixed(6)} · 모든 시도 상한 누적 US${(data.ai.probeCommittedUsdMicros / 1_000_000).toFixed(6)}</p><p>기존 승인 범위는 등록된 시험 입력으로 제한돼요. 아래 동의가 서버의 승인 범위를 넓히지는 않아요.</p></> : <p>현재 확인된 고정 시험 한도 없음 · 요청별 서버 승인이 필요해요.</p>}{funding?.pendingPayment && <p>원화 청구 미확정 · {(funding.pendingPayment.reservedKrwUnits / 1_000_000).toLocaleString("ko-KR")}원 예산 예약 유지</p>}<p>추가·자동 충전은 하지 않아요. 이번 요청과 재시도의 예약액은 서버가 전송 전에 계산하며, 남은 한도를 넘으면 중단해요.</p></div>}
    {issues.length > 0 && <ul className="tutor-ai-issues" aria-label="AI 요청 제한 사유">{issues.map((issue): ReactElement => <li key={issue}>{issue}</li>)}</ul>}
    {failure && <p role="alert">{failure}</p>}
    <label className="tutor-ai-consent"><input type="checkbox" checked={consented} disabled={reading || availability.kind !== "available" || issues.length > 0} onChange={(event): void => setConsented(event.target.checked)} />위 내용을 OpenAI로 전송하고 API 비용이 발생할 수 있음에 동의해요.</label>
    <ActionButton id={id} type="submit" tone="primary" availability={allowed}>{label}</ActionButton>
  </form>;
}

