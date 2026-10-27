"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactElement } from "react";
import { z } from "zod";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import { advisorState } from "@/lib/advisor/contracts";
import type { AdvisorState } from "@/lib/advisor/contracts";
import type { AdvisorAction } from "@/lib/advisor/request";
import { learningConditions } from "@/lib/advisor/conditions";
import { recordId } from "@/lib/domain/contracts";
import { AdvisorSteps, advisorSteps, currentAdvisorStep } from "./advisor-steps";
import type { AdvisorStep } from "./advisor-steps";
import { AdvisorEvidence, AdvisorRecordSummary } from "./advisor-evidence";
import { PlanEditor } from "./plan-editor";
import { useDraftNavigation } from "@/lib/use-draft-navigation";

const responseSchema = z.object({ session: advisorState });
type DraftFlags = Readonly<{ conditions: boolean; answer: boolean; plan: boolean }>;
type PendingAttempt = Readonly<{ input: AdvisorAction; body: string; key: string }>;
const cleanDrafts: DraftFlags = { conditions: false, answer: false, plan: false };
const errorSchema = z.object({ error: z.string(), message: z.string().optional() });
function splitLines(value: string): string[] { return value.split("\n").map((line): string => line.trim()).filter(Boolean); }
function fields(form: HTMLFormElement): FormData { return new FormData(form); }
function requiredField(data: FormData, key: string): string { const value: FormDataEntryValue | null = data.get(key); if (typeof value !== "string") throw new Error(`${key} 입력을 확인해 주세요.`); return value; }

export function AdvisorClient({ initial, today }: Readonly<{ initial: readonly AdvisorState[]; today: string }>): ReactElement {
  const ready: boolean = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const [sessions, setSessions] = useState<readonly AdvisorState[]>(initial);
  const [selected, setSelected] = useState<AdvisorState | null>(initial[0] ?? null);
  const [step, setStep] = useState<AdvisorStep>(currentAdvisorStep(initial[0] ?? null));
  const stepTitle = useRef<HTMLHeadingElement>(null);
  useEffect((): void => { if (!ready) return; stepTitle.current?.focus({ preventScroll: true }); stepTitle.current?.scrollIntoView({ block: "start", behavior: "instant" }); }, [step, ready]);
  const [pendingOperation, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [edits, setEdits] = useState<DraftFlags>(cleanDrafts);
  const currentEdits = useRef<DraftFlags>(cleanDrafts);
  const current = useRef<AdvisorState | null>(initial[0] ?? null);
  const inFlight = useRef<boolean>(false);
  const [recordRevision, setRecordRevision] = useState<number>(0);
  const [conditionRevision, setConditionRevision] = useState<number>(0);
  const [conflicted, setConflicted] = useState<boolean>(false);
  const [requiresRefresh, setRequiresRefresh] = useState<boolean>(false);
  const [uncertain, setUncertain] = useState<boolean>(false);
  const [retryKind, setRetryKind] = useState<"AI" | "저장">("저장");
  const pending = useRef<PendingAttempt | null>(null);
  const newId = useRef<string>(crypto.randomUUID());
  const working: boolean = pendingOperation || !ready;
  const navigationBusy: boolean = pendingOperation || uncertain || requiresRefresh || conflicted;
  const busy: boolean = navigationBusy || !ready;
  const dirty: boolean = edits.conditions || edits.answer || edits.plan;
  const keepBeforeLeave = useCallback(async (): Promise<boolean> => { setError("작성 중인 입력을 먼저 저장하거나 직접 비운 뒤 이동해 주세요. 입력은 이 화면에 유지돼요."); return false; }, []);
  useDraftNavigation({ dirty, busy: working || uncertain, save: keepBeforeLeave, onError: setError });
  function markDraft(kind: keyof DraftFlags, value: boolean): void { currentEdits.current = { ...currentEdits.current, [kind]: value }; setEdits(currentEdits.current); }
  function accept(session: AdvisorState): void {
    current.current = session; setSelected(session); setStep(currentAdvisorStep(session));
    setSessions((records): readonly AdvisorState[] => [session, ...records.filter((item): boolean => item.id !== session.id)]);
  }
  async function readRecord(id: string): Promise<AdvisorState> {
    const response: Response = await fetch(`/api/advisor?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const raw: unknown = await response.json();
    if (!response.ok) throw new Error(`${errorSchema.parse(raw).message ?? "기록을 불러오지 못했어요."} (HTTP ${response.status}, 기록 ${id})`);
    const next: AdvisorState = responseSchema.parse(raw).session;
    if (next.id !== id || current.current?.id === id && next.version < current.current.version) throw new Error("요청한 기록과 서버 응답의 버전이 맞지 않아요. 입력은 유지했으니 다시 조회해 주세요.");
    return next;
  }
  async function refresh(id: string): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const next: AdvisorState = await readRecord(id);
      const previous: AdvisorState | null = current.current;
      const hasRecordDraft: boolean = currentEdits.current.answer || currentEdits.current.plan;
      if (hasRecordDraft && (previous?.id !== next.id || previous.version !== next.version)) {
        setConflicted(true); setError("서버에 다른 기록이 있어요. 작성 중인 답변·계획은 이 화면에 유지했으며 덮어쓰지 않았어요. 내용을 보관한 뒤 최신 기록을 적용해 주세요."); return;
      }
      if (previous?.id !== next.id || previous.version !== next.version) { accept(next); setRecordRevision((value): number => value + 1); }
      if (pending.current && (pending.current.input.action === "generate" || pending.current.input.action === "recover") && (next.pending !== null || next.version > pending.current.input.expectedVersion)) { pending.current = null; setUncertain(false); }
      setRequiresRefresh(false); setConflicted(false);
    } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function discardRecordDraft(): Promise<void> {
    const id: string | undefined = current.current?.id;
    if (!id || inFlight.current || pending.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { const next: AdvisorState = await readRecord(id); markDraft("answer", false); markDraft("plan", false); accept(next); setRecordRevision((value): number => value + 1); setConflicted(false); setRequiresRefresh(false); }
    catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function send(attempt: PendingAttempt): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); pending.current = attempt; setRetryKind(attempt.input.action === "generate" || attempt.input.action === "recover" ? "AI" : "저장");
    try {
      const response: Response = await fetch("/api/advisor", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": attempt.key }, body: attempt.body });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const failure = errorSchema.parse(raw);
        if (response.status < 500) { pending.current = null; setUncertain(false); }
        if (failure.error === "version_conflict") setRequiresRefresh(true);
        throw new Error(`${failure.message ?? "요청을 처리하지 못했어요."} (${failure.error}, HTTP ${response.status}, ${attempt.input.action}, 기록 ${attempt.input.id})`);
      }
      const next: AdvisorState = responseSchema.parse(raw).session;
      if (next.id !== attempt.input.id || next.version < attempt.input.expectedVersion) throw new Error("저장 응답의 기록·버전이 요청과 맞지 않아요. 같은 요청의 결과를 확인해 주세요.");
      if (attempt.input.action === "start") { markDraft("conditions", false); setConditionRevision((value): number => value + 1); newId.current = crypto.randomUUID(); }
      if (attempt.input.action === "answer") markDraft("answer", false);
      if (attempt.input.action === "edit") markDraft("plan", false);
      accept(next); setRecordRevision((value): number => value + 1); pending.current = null; setUncertain(false); setRequiresRefresh(false); setConflicted(false);
    } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); setUncertain(pending.current !== null); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function submit(input: AdvisorAction): Promise<void> {
    if (inFlight.current || !ready) return;
    if (pending.current || requiresRefresh || conflicted) { setError("이전 요청 결과나 최신 기록을 먼저 확인해 주세요. 작성한 입력은 유지돼요."); return; }
    if (input.action === "start" && (currentEdits.current.answer || currentEdits.current.plan)) { setError("현재 진단의 답변·계획 수정을 먼저 저장하거나 비워 주세요. 새 학습 조건은 유지돼요."); return; }
    await send({ input, body: JSON.stringify(input), key: crypto.randomUUID() });
  }
  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const data: FormData = fields(event.currentTarget);
    const parsed = learningConditions.safeParse({ title: requiredField(data, "title"), domain: requiredField(data, "domain"), purpose: requiredField(data, "purpose"), selfReportedLevel: requiredField(data, "selfReportedLevel"), minutesPerWeek: Number(requiredField(data, "minutesPerWeek")), startDate: requiredField(data, "startDate"), endDate: requiredField(data, "endDate"), excludedScope: splitLines(requiredField(data, "excludedScope")) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    await submit({ action: "start", id: recordId.parse(newId.current), expectedVersion: 1, conditions: parsed.data });
  }
  return <div className="advisor-content" inert={!ready}>
    <AdvisorSteps step={step} state={selected} busy={navigationBusy} onStep={setStep} />
    <h2 ref={stepTitle} tabIndex={-1} className="advisor-step-title">{advisorSteps.find((item): boolean => item.id === step)?.label}</h2>
    <section hidden={step !== "conditions"} aria-label="학습 조건 단계">
    <details open={sessions.length === 0}><summary>새 학습 조건 입력</summary><form key={conditionRevision} onSubmit={start} onChange={(): void => markDraft("conditions", true)} className="advisor-form"><fieldset disabled={busy}><label>학습 이름<input name="title" required maxLength={200} placeholder="예: 전기기사 회로이론" /></label><label>학습 유형<select name="domain"><option value="major">전공 학습</option><option value="certification">자격증 준비</option><option value="practical">실무·교재 학습</option></select></label><label>학습 목적<textarea name="purpose" required maxLength={2000} /></label><label>현재 수준 · 자기 보고<textarea name="selfReportedLevel" required maxLength={2000} /></label><label>주간 학습 시간 (분)<input name="minutesPerWeek" type="number" inputMode="numeric" min={1} max={10080} required /></label><div className="advisor-dates"><label>시작일 (서울)<input name="startDate" type="date" required defaultValue={today} /></label><label>종료일 (서울)<input name="endDate" type="date" required /></label></div><label>이번에 제외할 내용 · 한 줄에 하나<textarea name="excludedScope" /></label><button disabled={busy} type="submit">학습 조건 저장</button><button type="reset" disabled={working} onClick={(): void => markDraft("conditions", false)}>학습 조건 입력 비우기</button></fieldset></form></details></section>
    {sessions.length > 0 && <label className="advisor-session">진단 기록<select value={selected?.id ?? ""} onChange={(event): void => { void refresh(event.target.value); }} disabled={busy || dirty}>{sessions.map((session) => <option key={session.id} value={session.id}>{session.conditions.title} · {session.phase === "confirmed" ? "확정" : session.phase === "draft" ? "초안" : "진행 중"}</option>)}</select></label>}
    {error && <p role="alert" className="advisor-alert">{error}</p>}{pendingOperation && <p role="status">저장된 기록을 확인하고 있어요. 중복으로 요청하지 않아도 됩니다.</p>}
    {dirty && <p role="status">이 화면에 아직 저장하지 않은 입력이 있어요. 새로고침·종료 전에 저장해 주세요.</p>}
    {uncertain && <aside className="advisor-alert" aria-label="처리 결과 확인"><p>처리 결과를 아직 확인하지 못했어요. 입력은 이 화면에 유지돼요. 새 요청을 만들지 않고 기존 요청을 확인합니다.</p><button type="button" disabled={working} onClick={(): void => { if (pending.current) void send(pending.current); }}>같은 요청 결과 다시 확인</button>{retryKind === "AI" && <button type="button" disabled={working} onClick={(): void => { if (pending.current) void refresh(pending.current.input.id); }}>AI 요청의 저장 상태 읽기</button>}</aside>}
    {conflicted && <button type="button" disabled={working || uncertain} onClick={(): void => { void discardRecordDraft(); }}>작성 중 입력 버리고 최신 기록 적용</button>}
    {selected && <section aria-label="현재 학습 진단" key={selected.id}><div className="advisor-heading"><h2>{selected.conditions.title}</h2><button type="button" disabled={working} onClick={(): void => { void refresh(selected.id); }}>최신 기록 불러오기</button></div><p>{selected.conditions.startDate} ~ {selected.conditions.endDate} · 주 {selected.conditions.minutesPerWeek}분 · 기록 {selected.version}판</p><p><strong>자기 보고:</strong> {selected.conditions.selfReportedLevel}</p><p>진단 답변과 AI 해석은 초기 계획의 근거입니다. 독립 수행이나 단원 통과를 확정하지 않습니다.</p>
      <AdvisorRecordSummary state={selected} />
      <AdvisorEvidence state={selected} />
      <section hidden={step !== "answer"} aria-label="답변 단계">{selected.question ? <QuestionForm key={`${selected.question.id}:${recordRevision}`} state={selected} busy={busy} submit={submit} onDirty={(value): void => markDraft("answer", value)} /> : <p>현재 작성할 질문은 없어요. 제출한 답변과 도움 사용 기록에서 저장된 답변을 확인할 수 있어요.</p>}</section>
      <section hidden={step !== "questions"} aria-label="질문 단계">{selected.question && <div><p>현재 질문: {selected.question.prompt}</p><button type="button" onClick={(): void => setStep("answer")}>답변 작성하기</button></div>}{selected.draft && <p>진단을 마쳤어요. 계획 검토 단계에서 저장된 계획을 확인해 주세요.</p>}
      {!selected.question && ["diagnosis", "planning"].includes(selected.phase) && <div className="advisor-next"><p>{selected.pending ? "처리 중이거나 결과가 미확정인 요청이 있어요. 같은 요청의 상태를 확인합니다." : selected.phase === "planning" ? "설명·수행 진단을 마쳤어요. 학습계획 초안을 제안받을 수 있어요." : "저장된 답변을 바탕으로 한 번에 한 질문만 진행합니다."}</p><button disabled={busy} onClick={(): void => { void submit({ action: selected.pending ? "recover" : "generate", id: selected.id, expectedVersion: selected.version }); }}>{selected.pending ? "기존 AI 요청 확인" : selected.phase === "planning" ? "AI 계획 초안 만들기" : selected.answers.length >= 2 ? "추가 진단 여부 확인하기" : "다음 진단 질문 받기"}</button><p className="advisor-note">AI 호출은 기존 API 크레딧과 비용 보호 정책을 사용해요. 원화 비용 설정이 미확정인 동안 일반 진단 호출은 차단될 수 있어요.</p></div>}
      </section>
      <div hidden={step !== "plan" && step !== "confirmation"}>{selected.draft && <PlanEditor key={`${selected.id}:${recordRevision}`} state={selected} busy={busy} submit={submit} step={step} onStep={setStep} onDirty={(value): void => markDraft("plan", value)} />}</div>
    </section>}
  </div>;
}

type FormProps = Readonly<{ state: AdvisorState; busy: boolean; submit: (input: AdvisorAction) => Promise<void>; onDirty: (value: boolean) => void }>;
function QuestionForm({ state, busy, submit, onDirty }: FormProps): ReactElement {
  const question = state.question;
  if (!question) throw new Error("현재 질문이 필요해요.");
  async function answer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!question) throw new Error("현재 질문이 필요해요."); const data = fields(event.currentTarget);
    await submit({ action: "answer", id: state.id, expectedVersion: state.version, answer: { questionId: question.id, text: requiredField(data, "answer"), materialUsed: data.has("materialUsed"), hintUsed: data.has("hintUsed"), answerSeen: data.has("answerSeen") } });
  }
  return <form onSubmit={answer} onChange={(): void => onDirty(true)} className="advisor-form advisor-question"><p className="eyebrow">{state.answers.length + 1}번째 질문 · {question.mode === "explanation" ? "설명 진단" : "수행 진단"} (최대 6개)</p><h3>{question.prompt}</h3><label>나의 답변<textarea name="answer" disabled={busy} required maxLength={6000} rows={6} /></label><p>답변 중 사용한 도움을 모두 표시해 주세요. 이 기록은 지워지지 않아요.</p><label className="advisor-check"><input type="checkbox" disabled={busy} name="materialUsed" />자료를 참고했어요</label><label className="advisor-check"><input type="checkbox" disabled={busy} name="hintUsed" />힌트·다른 사람의 도움을 받았어요</label><label className="advisor-check"><input type="checkbox" disabled={busy} name="answerSeen" />답안을 보았어요</label><button disabled={busy}>답변 저장</button><button type="reset" disabled={busy} onClick={(): void => onDirty(false)}>답변 입력 비우기</button></form>;
}
