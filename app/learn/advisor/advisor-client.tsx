"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactElement } from "react";
import { z } from "zod";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import { advisorState, planAttention } from "@/lib/advisor/contracts";
import type { AdvisorState, PlanProposal } from "@/lib/advisor/contracts";
import type { AdvisorAction } from "@/lib/advisor/request";
import { learningConditions, availableMinutes } from "@/lib/advisor/conditions";
import { recordId } from "@/lib/domain/contracts";

const responseSchema = z.object({ session: advisorState });
const errorSchema = z.object({ error: z.string(), message: z.string().optional() });
function splitLines(value: string): string[] { return value.split("\n").map((line): string => line.trim()).filter(Boolean); }
function prerequisiteTitles(proposal: PlanProposal, keys: readonly string[]): string {
  if (keys.length === 0) return "없음";
  return keys.map((key): string => {
    const unit = proposal.units.find((candidate): boolean => candidate.key === key);
    if (!unit) throw new Error(`선행 단원을 찾을 수 없어요: ${key}`);
    return unit.title;
  }).join(", ");
}
function fields(form: HTMLFormElement): FormData { return new FormData(form); }
function requiredField(data: FormData, key: string): string { const value: FormDataEntryValue | null = data.get(key); if (typeof value !== "string") throw new Error(`${key} 입력을 확인해 주세요.`); return value; }

export function AdvisorClient({ initial, today }: Readonly<{ initial: readonly AdvisorState[]; today: string }>): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [sessions, setSessions] = useState<readonly AdvisorState[]>(initial);
  const [selected, setSelected] = useState<AdvisorState | null>(initial[0] ?? null);
  const [pendingOperation, setBusy] = useState<boolean>(false);
  const busy: boolean = pendingOperation || !ready;
  const [error, setError] = useState<string>("");
  const pending = useRef<Readonly<{ body: string; key: string }> | null>(null);
  const newId = useRef<string>(crypto.randomUUID());
  function accept(session: AdvisorState): void { setSelected(session); setSessions((current) => [session, ...current.filter((item): boolean => item.id !== session.id)]); }
  async function refresh(id: string): Promise<void> {
    setBusy(true); setError("");
    try { const result: Response = await fetch(`/api/advisor?id=${encodeURIComponent(id)}`, { cache: "no-store" }); const raw: unknown = await result.json(); if (!result.ok) throw new Error(errorSchema.parse(raw).message ?? "기록을 불러오지 못했어요."); accept(responseSchema.parse(raw).session); }
    catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); }
    finally { setBusy(false); }
  }
  async function submit(input: AdvisorAction): Promise<void> {
    if (busy) return; setBusy(true); setError("");
    const body: string = JSON.stringify(input); const key: string = pending.current?.body === body ? pending.current.key : crypto.randomUUID(); pending.current = { body, key };
    try {
      const result: Response = await fetch("/api/advisor", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body });
      const raw: unknown = await result.json();
      if (!result.ok) { const failure = errorSchema.parse(raw); throw new Error(`${failure.message ?? "요청을 처리하지 못했어요."} (${failure.error}, HTTP ${result.status})`); }
      accept(responseSchema.parse(raw).session); pending.current = null;
      if (input.action === "start") newId.current = crypto.randomUUID();
    } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); }
    finally { setBusy(false); }
  }
  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const data: FormData = fields(event.currentTarget);
    const parsed = learningConditions.safeParse({ title: requiredField(data, "title"), domain: requiredField(data, "domain"), purpose: requiredField(data, "purpose"), selfReportedLevel: requiredField(data, "selfReportedLevel"), minutesPerWeek: Number(requiredField(data, "minutesPerWeek")), startDate: requiredField(data, "startDate"), endDate: requiredField(data, "endDate"), excludedScope: splitLines(requiredField(data, "excludedScope")) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    await submit({ action: "start", id: recordId.parse(newId.current), expectedVersion: 1, conditions: parsed.data });
  }
  return <div className="advisor-content">
    <details open={sessions.length === 0}><summary>새 학습 조건 입력</summary><form onSubmit={start} className="advisor-form"><label>학습 이름<input name="title" required maxLength={200} placeholder="예: 전기기사 회로이론" /></label><label>학습 유형<select name="domain"><option value="major">전공 학습</option><option value="certification">자격증 준비</option><option value="practical">실무·교재 학습</option></select></label><label>학습 목적<textarea name="purpose" required maxLength={2000} /></label><label>현재 수준 · 자기 보고<textarea name="selfReportedLevel" required maxLength={2000} /></label><label>주간 학습 시간 (분)<input name="minutesPerWeek" type="number" inputMode="numeric" min={1} max={10080} required /></label><div className="advisor-dates"><label>시작일 (서울)<input name="startDate" type="date" required defaultValue={today} /></label><label>종료일 (서울)<input name="endDate" type="date" required /></label></div><label>이번에 제외할 내용 · 한 줄에 하나<textarea name="excludedScope" /></label><button disabled={busy} type="submit">학습 조건 저장</button></form></details>
    {sessions.length > 0 && <label className="advisor-session">진단 기록<select value={selected?.id ?? ""} onChange={(event): void => { void refresh(event.target.value); }} disabled={busy}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.conditions.title} · {session.phase === "confirmed" ? "확정" : session.phase === "draft" ? "초안" : "진행 중"}</option>)}</select></label>}
    {error && <p role="alert" className="advisor-alert">{error}</p>}{busy && <p role="status">저장된 기록을 확인하고 있어요. 중복으로 요청하지 않아도 됩니다.</p>}
    {selected && <section aria-label="현재 학습 진단" key={selected.id}><div className="advisor-heading"><h2>{selected.conditions.title}</h2><button type="button" disabled={busy} onClick={(): void => { void refresh(selected.id); }}>최신 기록 불러오기</button></div><p>{selected.conditions.startDate} ~ {selected.conditions.endDate} · 주 {selected.conditions.minutesPerWeek}분 · 기록 {selected.version}판</p><p><strong>자기 보고:</strong> {selected.conditions.selfReportedLevel}</p><p>진단 답변과 AI 해석은 초기 계획의 근거입니다. 독립 수행이나 단원 통과를 확정하지 않습니다.</p>
      {selected.answers.length > 0 && <details><summary>제출한 답변과 도움 사용 기록 ({selected.answers.length})</summary>{selected.answers.map((answer) => <article key={answer.id}><h3>{answer.mode === "explanation" ? "설명 답변" : "수행 답변"} · 제출 기록</h3><p className="advisor-pre">{answer.text}</p><p>자료 사용 {answer.materialUsed ? "있음" : "없음"} / 힌트 {answer.hintUsed ? "있음" : "없음"} / 답안 노출 {answer.answerSeen ? "있음" : "없음"} (사용자 신고)</p>{selected.estimates.filter((item): boolean => item.answerId === answer.id).map((estimate) => <div key={estimate.answerId}><p><strong>AI 초기 추정:</strong> {estimate.interpretation}</p><blockquote>{estimate.quote}</blockquote><p>미확인: {estimate.unverified.join(", ")}</p></div>)}</article>)}</details>}
      {selected.question && <QuestionForm key={selected.question.id} state={selected} busy={busy} submit={submit} />}
      {!selected.question && ["diagnosis", "planning"].includes(selected.phase) && <div className="advisor-next"><p>{selected.pending ? "처리 중이거나 결과가 미확정인 요청이 있어요. 같은 요청의 상태를 확인합니다." : selected.phase === "planning" ? "설명·수행 진단을 마쳤어요. 학습계획 초안을 제안받을 수 있어요." : "저장된 답변을 바탕으로 한 번에 한 질문만 진행합니다."}</p><button disabled={busy} onClick={(): void => { void submit({ action: selected.pending ? "recover" : "generate", id: selected.id, expectedVersion: selected.version }); }}>{selected.pending ? "기존 AI 요청 확인" : selected.phase === "planning" ? "AI 계획 초안 만들기" : selected.answers.length >= 2 ? "추가 진단 여부 확인하기" : "다음 진단 질문 받기"}</button><p className="advisor-note">AI 호출은 기존 API 크레딧과 비용 보호 정책을 사용해요. 원화 비용 설정이 미확정인 동안 일반 진단 호출은 차단될 수 있어요.</p></div>}
      {selected.draft && <PlanEditor key={`${selected.id}:${selected.version}`} state={selected} busy={busy} submit={submit} />}
    </section>}
  </div>;
}

type FormProps = Readonly<{ state: AdvisorState; busy: boolean; submit: (input: AdvisorAction) => Promise<void> }>;
function QuestionForm({ state, busy, submit }: FormProps): ReactElement {
  const question = state.question;
  if (!question) throw new Error("현재 질문이 필요해요.");
  async function answer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!question) throw new Error("현재 질문이 필요해요."); const data = fields(event.currentTarget);
    await submit({ action: "answer", id: state.id, expectedVersion: state.version, answer: { questionId: question.id, text: requiredField(data, "answer"), materialUsed: data.has("materialUsed"), hintUsed: data.has("hintUsed"), answerSeen: data.has("answerSeen") } });
  }
  return <form onSubmit={answer} className="advisor-form advisor-question"><p className="eyebrow">{state.answers.length + 1}번째 질문 · {question.mode === "explanation" ? "설명 진단" : "수행 진단"} (최대 6개)</p><h3>{question.prompt}</h3><label>나의 답변<textarea name="answer" required maxLength={6000} rows={6} /></label><p>답변 중 사용한 도움을 모두 표시해 주세요. 이 기록은 지워지지 않아요.</p><label className="advisor-check"><input type="checkbox" name="materialUsed" />자료를 참고했어요</label><label className="advisor-check"><input type="checkbox" name="hintUsed" />힌트·다른 사람의 도움을 받았어요</label><label className="advisor-check"><input type="checkbox" name="answerSeen" />답안을 보았어요</label><button disabled={busy}>답변 저장</button></form>;
}
function PlanEditor({ state, busy, submit }: FormProps): ReactElement {
  if (!state.draft) throw new Error("계획 초안이 필요해요.");
  const [draft, setDraft] = useState<PlanProposal>(state.draft);
  const [reviewed, setReviewed] = useState<boolean>(false);
  const locked: boolean = state.phase === "confirmed";
  const dirty: boolean = JSON.stringify(draft) !== JSON.stringify(state.draft);
  const total: number = draft.units.reduce((sum: number, unit): number => sum + unit.minutes, 0);
  function move(index: number, direction: number): void { const next = [...draft.units]; const target: number = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; setDraft({ ...draft, units: next }); }
  return <section className="advisor-plan" aria-label="학습계획"><h2>{locked ? "확정한 학습계획" : "학습계획 초안"}</h2>{locked && <p role="status">직접 검토한 {state.version - 1}판이 정식 계획으로 저장됐어요. 단원 수행 상태는 모두 미확인입니다.</p>}<label htmlFor="advisor-objective">학습 목표</label><textarea id="advisor-objective" value={draft.objective} maxLength={2000} disabled={locked || busy} onChange={(event): void => { setDraft({ ...draft, objective: event.target.value }); }} /><p>선수 지식: {draft.prerequisites.join(", ")}</p><p>총 {total}분 / 기간 내 {availableMinutes(state.conditions)}분</p><ol>{draft.units.map((unit, index) => <li key={unit.key}><h3>{unit.title} <small>자기 설명·독립 수행·지연 재현 미확인</small></h3><p>{unit.objective}</p><label>계획 시간 (분)<input aria-label={`${unit.title} 계획 시간`} type="number" inputMode="numeric" min={1} max={10080} disabled={locked || busy} value={unit.minutes} onChange={(event): void => { setDraft({ ...draft, units: draft.units.map((item, position) => position === index ? { ...item, minutes: Number(event.target.value) } : item) }); }} /></label><p>① 자료를 가린 자기 설명: {unit.selfExplanationCriterion}</p><p>② 새로운 변경 조건의 무도움 풀이: {unit.newConditionCriterion}</p><p>선행 단원: {prerequisiteTitles(draft, unit.prerequisiteKeys)}</p>{!locked && <div className="advisor-actions"><button type="button" disabled={busy || index === 0} onClick={(): void => move(index, -1)} aria-label={`${unit.title} 위로`}>위로</button><button type="button" disabled={busy || index === draft.units.length - 1} onClick={(): void => move(index, 1)} aria-label={`${unit.title} 아래로`}>아래로</button></div>}</li>)}</ol><label htmlFor="advisor-exclusions">제외 범위 · 한 줄에 하나</label><textarea id="advisor-exclusions" value={draft.excludedScope.join("\n")} disabled={locked || busy} onChange={(event): void => { setDraft({ ...draft, excludedScope: splitLines(event.target.value) }); }} /><p>AI가 초안을 만들 때 남긴 확인 사항입니다. 이후 직접 수정한 내용과 다를 수 있어요.</p><ul>{planAttention(draft, state.conditions).map((attention, index) => <li key={index}>{attention}</li>)}</ul><p>두 통과 요건을 모두 충족해야 합니다. 도움을 받은 답은 독립 수행으로 인정하지 않고 새로운 조건에서 다시 확인해요. 지연 재현은 다음 단원 진행과 별도로 확인합니다.</p><details><summary>후속 학습에 적용할 규칙</summary><p>질문 후 답변을 기다리고, 방향 → 힌트 → 예시 → 답 순서로 도움을 줍니다. Editor는 핵심 문제 1~2개를 제시한 뒤 수정 답변과 이유를 기다립니다. 복습은 조건을 바꾸며, 주간 조정은 확정 근거만 사용하고 관련 오답·복습에 정정을 전파합니다. 이 화면은 계획을 저장하며 수업·복습이나 Google 기록을 실행하지 않습니다.</p></details>{!locked && <div className="advisor-confirm"><button type="button" disabled={busy || !dirty} onClick={(): void => { if (!state.draft) throw new Error("초안이 필요해요."); setDraft(state.draft); setReviewed(false); }}>수정 취소</button><button disabled={busy || !dirty} onClick={(): void => { void submit({ action: "edit", id: state.id, expectedVersion: state.version, proposal: draft }); }}>초안 수정 저장</button><label className="advisor-check"><input type="checkbox" checked={reviewed} disabled={busy || dirty} onChange={(event): void => setReviewed(event.target.checked)} />이 {state.version}판의 진단 근거, 목표·순서·시간·제외 범위와 필수 통과 기준을 검토했어요.</label><button disabled={busy || dirty || !reviewed || total > availableMinutes(state.conditions)} onClick={(): void => { void submit({ action: "confirm", id: state.id, expectedVersion: state.version, choices: { reviewedVersion: state.version, reviewedEvidence: true, acceptedAssessment: true, acceptedScopeAndTime: true } }); }}>이 계획으로 확정</button></div>}</section>;
}
