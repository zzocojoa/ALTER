"use client";
import { useState } from "react";
import type { ReactElement } from "react";
import { StatusBadge } from "@/components/alter/status";
import { availableMinutes } from "@/lib/advisor/conditions";
import { planAttention } from "@/lib/advisor/contracts";
import type { AdvisorState, PlanProposal } from "@/lib/advisor/contracts";
import type { AdvisorAction } from "@/lib/advisor/request";
import type { AdvisorStep } from "./advisor-steps";

type PlanUnit = PlanProposal["units"][number];
type PlanEditorProps = Readonly<{ state: AdvisorState; busy: boolean; submit: (input: AdvisorAction) => Promise<void>; step: AdvisorStep; onStep: (step: AdvisorStep) => void; onDirty: (value: boolean) => void }>;

function prerequisiteTitles(proposal: PlanProposal, keys: readonly string[]): string {
  if (keys.length === 0) return "없음";
  return keys.map((key): string => {
    const unit: PlanUnit | undefined = proposal.units.find((candidate): boolean => candidate.key === key);
    if (!unit) throw new Error(`선행 단원을 찾을 수 없어요: ${key}`);
    return unit.title;
  }).join(", ");
}

function PlanTimeSummary({ total, capacity, count }: Readonly<{ total: number | null; capacity: number; count: number }>): ReactElement {
  return <aside className="advisor-plan-time" aria-label="계획 시간 합계"><dl>
    <div><dt>단원</dt><dd>{count}개</dd></div><div><dt>배정 시간</dt><dd>{total === null ? "입력 확인 필요" : `총 ${total}분`}</dd></div><div><dt>기간 내 가용 시간</dt><dd>{capacity}분</dd></div>
  </dl>{total !== null && total > capacity && <p role="status">가용 시간보다 {total - capacity}분 많아요. 시간을 줄여 저장한 뒤 확정해 주세요.</p>}</aside>;
}

function UnitCriteria({ unit }: Readonly<{ unit: PlanUnit }>): ReactElement {
  return <div className="advisor-unit-criteria">
    <section aria-label="자기 설명 통과 기준"><h4>① 자료를 가린 자기 설명</h4><p>{unit.selfExplanationCriterion}</p></section>
    <section aria-label="새로운 조건 통과 기준"><h4>② 새로운 조건의 무도움 풀이</h4><p>{unit.newConditionCriterion}</p></section>
  </div>;
}

/** 계획의 단원 순서와 두 통과 기준을 저장된 수행 판정과 분리해 보여줍니다. */
export function PlanEditor({ state, busy, submit, step, onStep, onDirty }: PlanEditorProps): ReactElement {
  if (!state.draft) throw new Error("계획 초안이 필요해요.");
  const [draft, setDraft] = useState<PlanProposal>(state.draft);
  const [minuteTexts, setMinuteTexts] = useState<Readonly<Record<string, string>>>(Object.fromEntries(state.draft.units.map((unit): [string, string] => [unit.key, String(unit.minutes)])));
  const [excludedText, setExcludedText] = useState<string>(state.draft.excludedScope.join("\n"));
  const [reviewed, setReviewed] = useState<boolean>(false);
  const locked: boolean = state.phase === "confirmed";
  const dirty: boolean = JSON.stringify(draft) !== JSON.stringify(state.draft) || excludedText !== state.draft.excludedScope.join("\n");
  const total: number = draft.units.reduce((sum: number, unit: PlanUnit): number => sum + unit.minutes, 0);
  const invalidMinutes: boolean = draft.units.some((unit): boolean => minuteTexts[unit.key].trim() === "" || !Number.isSafeInteger(unit.minutes) || unit.minutes < 1 || unit.minutes > 10080);
  const capacity: number = availableMinutes(state.conditions);
  function updateDraft(next: PlanProposal): void {
    if (!state.draft) throw new Error("계획 초안이 필요해요.");
    setDraft(next); setReviewed(false); onDirty(JSON.stringify(next) !== JSON.stringify(state.draft) || excludedText !== state.draft.excludedScope.join("\n"));
  }
  function updateExclusions(text: string): void {
    if (!state.draft) throw new Error("계획 초안이 필요해요.");
    const next: PlanProposal = { ...draft, excludedScope: text.split("\n").map((line): string => line.trim()).filter(Boolean) };
    setExcludedText(text); setDraft(next); setReviewed(false); onDirty(JSON.stringify(next) !== JSON.stringify(state.draft) || text !== state.draft.excludedScope.join("\n"));
  }
  function move(index: number, direction: number): void {
    const target: number = index + direction;
    if (target < 0 || target >= draft.units.length) throw new RangeError("단원 이동 범위를 확인해 주세요.");
    const units: PlanUnit[] = draft.units.map((unit, position): PlanUnit => position === index ? draft.units[target] : position === target ? draft.units[index] : unit);
    updateDraft({ ...draft, units });
  }
  return <section className="advisor-plan" aria-label="학습계획">
    <h2>{locked ? "확정한 학습계획" : "학습계획 초안"}</h2>
    {locked && <p role="status">직접 검토한 {state.version - 1}판이 정식 계획으로 저장됐어요. 단원 수행 상태는 모두 미확인입니다.</p>}
    {locked && state.confirmedPlanVersionId && <aside className="advisor-plan-next" aria-label="확정 계획의 다음 행동"><h3>이 계획으로 오늘의 범위 정하기</h3><p>확정한 계획의 첫 단원을 열어요. 사용할 자료와 시간을 직접 정한 뒤 학습 범위를 저장할 수 있어요.</p><a className="alter-control alter-button" data-tone="primary" href={`/learn/library?plan=${encodeURIComponent(state.confirmedPlanVersionId)}#scope-setup`}>오늘의 학습 범위 정하기</a><p className="advisor-note">화면을 여는 것만으로 AI 비교·범위 확정·수업을 시작하지 않아요.</p></aside>}
    <div hidden={step !== "plan"}>
      <label htmlFor="advisor-objective">학습 목표</label><textarea id="advisor-objective" value={draft.objective} maxLength={2000} disabled={locked || busy} onChange={(event): void => updateDraft({ ...draft, objective: event.target.value })} />
      <p>선수 지식: {draft.prerequisites.length > 0 ? draft.prerequisites.join(", ") : "별도 항목 없음"}</p>
      <PlanTimeSummary total={invalidMinutes ? null : total} capacity={capacity} count={draft.units.length} />
      {invalidMinutes && <p role="status">각 단원의 계획 시간을 1~10,080분의 정수로 입력해 주세요. 빈 값은 저장하지 않아요.</p>}
      <h3>단원별 순서와 통과 기준</h3><p className="advisor-note">위에서부터 학습할 순서예요. 각 단원은 아래 두 기준을 모두 확인하며, 지연 재현은 별도 복습에서 확인해요.</p>
      <ol className="advisor-plan-units" aria-label="학습할 단원 순서">{draft.units.map((unit, index): ReactElement => <li key={unit.key}>
        <article className="advisor-unit" aria-label={`${index + 1}번째 단원: ${unit.title}`}>
          <div className="advisor-unit-heading"><span className="advisor-unit-number" aria-hidden="true">{index + 1}</span><h3>{unit.title}</h3></div>
          <p>{unit.objective}</p><StatusBadge label="자기 설명·독립 수행·지연 재현 미확인" tone="warning" />
          <div className="advisor-unit-meta"><p><strong>선행 단원</strong><span>{prerequisiteTitles(draft, unit.prerequisiteKeys)}</span></p>
          <label>계획 시간 (분)<input aria-label={`${unit.title} 계획 시간`} type="number" inputMode="numeric" min={1} max={10080} disabled={locked || busy} value={minuteTexts[unit.key]} onChange={(event): void => { setMinuteTexts({ ...minuteTexts, [unit.key]: event.target.value }); updateDraft({ ...draft, units: draft.units.map((item, position): PlanUnit => position === index ? { ...item, minutes: Number(event.target.value) } : item) }); }} /></label></div>
          <UnitCriteria unit={unit} />
          {!locked && <div className="advisor-actions"><button type="button" disabled={busy || index === 0} onClick={(): void => move(index, -1)} aria-label={`${unit.title} 위로`}>위로</button><button type="button" disabled={busy || index === draft.units.length - 1} onClick={(): void => move(index, 1)} aria-label={`${unit.title} 아래로`}>아래로</button></div>}
        </article>
      </li>)}</ol>
      <label htmlFor="advisor-exclusions">제외 범위 · 한 줄에 하나</label><textarea id="advisor-exclusions" value={excludedText} disabled={locked || busy} onChange={(event): void => updateExclusions(event.target.value)} />
      <aside className="advisor-plan-attention" aria-label="계획의 확인 사항"><h3>확인할 내용</h3><p>AI가 초안을 만들 때 남긴 확인 사항입니다. 이후 직접 수정한 내용과 다를 수 있어요.</p><ul>{planAttention(draft, state.conditions).map((attention, index): ReactElement => <li key={index}>{attention}</li>)}</ul></aside>
      <p>두 통과 요건을 모두 충족해야 합니다. 도움을 받은 답은 독립 수행으로 인정하지 않고 새로운 조건에서 다시 확인해요. 지연 재현은 다음 단원 진행과 별도로 확인합니다.</p>
      <details><summary>후속 학습에 적용할 규칙</summary><p>질문 후 답변을 기다리고, 방향 → 힌트 → 예시 → 답 순서로 도움을 줍니다. Editor는 핵심 문제 1~2개를 제시한 뒤 수정 답변과 이유를 기다립니다. 복습은 조건을 바꾸며, 주간 조정은 확정 근거만 사용하고 관련 오답·복습에 정정을 전파합니다. 이 화면은 계획을 저장하며 수업·복습이나 Google 기록을 실행하지 않습니다.</p></details>
      {!locked && <div className="advisor-confirm"><button type="button" disabled={busy || !dirty} onClick={(): void => { if (!state.draft) throw new Error("초안이 필요해요."); setDraft(state.draft); setMinuteTexts(Object.fromEntries(state.draft.units.map((unit): [string, string] => [unit.key, String(unit.minutes)]))); setExcludedText(state.draft.excludedScope.join("\n")); setReviewed(false); onDirty(false); }}>수정 취소</button><button disabled={busy || !dirty || invalidMinutes} onClick={(): void => { void submit({ action: "edit", id: state.id, expectedVersion: state.version, proposal: draft }); }}>초안 수정 저장</button></div>}
      <button type="button" disabled={busy} onClick={(): void => onStep("confirmation")}>확정 단계로</button>
    </div>
    <section hidden={step !== "confirmation"} aria-label="계획 확정 단계">
      <p>저장된 계획을 검토한 뒤 직접 확정해 주세요. 단계를 여는 것만으로 저장하거나 AI를 호출하지 않아요.</p>
      <PlanTimeSummary total={invalidMinutes ? null : total} capacity={capacity} count={draft.units.length} />
      <button type="button" onClick={(): void => onStep("plan")}>계획 내용 다시 보기</button>
      {dirty && <p role="status">아직 저장하지 않은 수정이 있어요. 계획 검토로 돌아가 수정본을 저장해 주세요.</p>}
      {!locked && <div className="advisor-confirm"><label className="advisor-check"><input type="checkbox" checked={reviewed} disabled={busy || dirty} onChange={(event): void => setReviewed(event.target.checked)} />이 {state.version}판의 진단 근거, 목표·순서·시간·제외 범위와 필수 통과 기준을 검토했어요.</label><button disabled={busy || dirty || invalidMinutes || !reviewed || total > capacity} onClick={(): void => { void submit({ action: "confirm", id: state.id, expectedVersion: state.version, choices: { reviewedVersion: state.version, reviewedEvidence: true, acceptedAssessment: true, acceptedScopeAndTime: true } }); }}>이 계획으로 확정</button></div>}
    </section>
  </section>;
}
