"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactElement } from "react";
import type { LibrarianOverview } from "@/lib/librarian/server";
import { scopeInput } from "@/lib/librarian/contracts";
import type { LibrarianAction } from "@/lib/librarian/request";
import { orderUnitOptions } from "@/lib/librarian/range";
import { materialIssues } from "@/lib/librarian/issues";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import { formText, librarianJson, overviewReply, scopeViewReply, LibrarianRequestError } from "./client-api";
import type { ScopeView } from "./client-api";
import { MaterialLinkForm } from "./link-form";
import { ScopeDetail } from "./scope-detail";
import { useDraftNavigation } from "@/lib/use-draft-navigation";
import { LibrarySteps, librarySteps } from "./library-steps";
import type { LibraryStep } from "./library-steps";
import { CandidateChoices, changeSelection } from "./selection-rows";
import { UnitRequirements } from "./material-evidence";
import { DraftScopeTiming } from "./scope-timing";
import type { ScopeTimeDraft } from "./scope-timing";
import { ActionButton } from "@/components/alter/action-button";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";

export function LibrarianClient({ initial, initialView }: Readonly<{ initial: LibrarianOverview; initialView: ScopeView | null }>): ReactElement {
  const [data,setData] = useState<LibrarianOverview>(initial); const [view,setView] = useState<ScopeView | null>(initialView); const [working,setWorking] = useState<boolean>(false); const [error,setError] = useState<string>("");
  const [retryAction,setRetryAction] = useState<LibrarianAction | null>(null);
  const [needsRefresh,setNeedsRefresh] = useState<boolean>(false);
  const [linkRevision,setLinkRevision] = useState<number>(0);
  const latestView = useRef<ScopeView | null>(initialView);
  function applyView(next: ScopeView | null): void {
    const current = latestView.current;
    if (next && current && next.scope.input.id === current.scope.input.id && next.scope.version < current.scope.version) throw new Error("더 오래된 범위 응답은 적용하지 않았어요. 최신 범위를 다시 읽어 주세요.");
    latestView.current = next; setView(next);
  }
  const [step,setStep] = useState<LibraryStep>(initialView === null ? "unit" : "review");
  const [sourceReady,setSourceReady] = useState<boolean>(false);
  const [sourceLoading,setSourceLoading] = useState<boolean>(false);
  const [scopeDirty,setScopeDirty] = useState<boolean>(false);
  const [selectedLinks,setSelectedLinks] = useState<readonly string[]>([]);
  const [times,setTimes] = useState<ScopeTimeDraft>({ available: "", questions: "", practice: "" });
  const [linkDirty,setLinkDirty] = useState<boolean>(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const [covered,setCovered] = useState<boolean>(false); const [checking,setChecking] = useState<boolean>(false);
  const accessRequest = useRef<AbortController | null>(null); const accessGeneration = useRef<number>(0);
  const selection = useRef<Readonly<{unitId:string|null;scopeId:string|null}>>({unitId:initial.unitId,scopeId:initialView?.scope.input.id ?? null});
  const restore = useCallback(async (): Promise<void> => {
    accessRequest.current?.abort(); const controller = new AbortController(); accessRequest.current=controller; const generation=++accessGeneration.current;
    setChecking(true); setCovered(true); setError("");
    try {
      const selected=selection.current;
      const [nextData,nextView]=await Promise.all([
        librarianJson(`/api/librarian${selected.unitId ? `?unit=${encodeURIComponent(selected.unitId)}` : ""}`,{method:"GET",signal:controller.signal}).then(value=>overviewReply.parse(value)),
        selected.scopeId ? librarianJson(`/api/librarian?id=${encodeURIComponent(selected.scopeId)}`,{method:"GET",signal:controller.signal}).then(value=>scopeViewReply.parse(value)) : Promise.resolve(null),
      ]);
      if(controller.signal.aborted || generation!==accessGeneration.current) return;
      if (selected.scopeId !== selection.current.scopeId || selected.unitId !== selection.current.unitId) throw new Error("확인 중 선택한 범위가 바뀌었어요. 원문을 가린 채 현재 범위를 다시 확인해 주세요.");
      if (nextView && nextView.scope.input.id !== selected.scopeId || nextData.unitId !== selected.unitId) throw new Error("요청한 단원·범위와 다른 응답이에요. 원문을 가린 채 다시 확인해 주세요.");
      applyView(nextView); setData(nextData); setCovered(false);
    } catch(cause:unknown) { if(controller.signal.aborted || generation!==accessGeneration.current) return; if(!(cause instanceof Error)) throw cause; setError(cause.message); }
    finally { if(generation===accessGeneration.current) setChecking(false); }
  },[]);
  useEffect(()=>{
    function hide():void { accessRequest.current?.abort(); accessGeneration.current++; setChecking(false); setCovered(true); }
    function show():void { if(document.visibilityState==="visible") void restore(); }
    function visibility():void { if(document.visibilityState==="hidden") hide(); else show(); }
    window.addEventListener("pagehide",hide); window.addEventListener("pageshow",show); window.addEventListener(RECALL_START_EVENT,hide); document.addEventListener("visibilitychange",visibility);
    return ():void=>{ accessRequest.current?.abort(); window.removeEventListener("pagehide",hide); window.removeEventListener("pageshow",show); window.removeEventListener(RECALL_START_EVENT,hide); document.removeEventListener("visibilitychange",visibility); };
  },[restore]);
  const ready: boolean = useSyncExternalStore(subscribeToHydration,clientReady,serverReady);
  const requestBusy: boolean = working || checking || sourceLoading;
  const busy: boolean = requestBusy || !ready;
  const locked: boolean = busy || retryAction !== null;
  const dirty: boolean = scopeDirty || linkDirty || retryAction !== null;
  const keepBeforeLeave = useCallback(async (): Promise<boolean> => { setError("작성 중인 구간·시간 입력을 먼저 저장하거나 비운 뒤 이동해 주세요. 입력은 이 화면에 보관돼요."); return false; }, []);
  useDraftNavigation({ dirty, busy, save: keepBeforeLeave, onError: setError });
  useEffect((): void => { if (ready && !covered) { stepHeading.current?.focus({ preventScroll: true }); stepHeading.current?.scrollIntoView({ block: "start", behavior: "instant" }); } }, [step,covered,ready]);
  const pending = useRef<Readonly<{ body: string; key: string }> | null>(null); const newId = useRef<string>(crypto.randomUUID());
  const unit = data.units.find((item): boolean => item.unitId === data.unitId);
  async function reload(id: string): Promise<void> {
    if (id !== data.unitId && dirty) { setError("작성 중인 입력을 저장하거나 비운 뒤 단원을 바꿔 주세요."); return; }
    setWorking(true); setError(""); try {
      const next = overviewReply.parse(await librarianJson(`/api/librarian?unit=${encodeURIComponent(id)}`,{ method: "GET" }));
      if (next.unitId !== id) throw new Error("다른 단원의 응답은 적용하지 않았어요. 선택한 단원을 다시 확인해 주세요.");
      if (id === data.unitId && selectedLinks.some((selectedId): boolean => !next.links.some((candidate): boolean => candidate.link.id === selectedId))) { setNeedsRefresh(true); throw new Error("선택한 자료 연결이 달라졌어요. 기존 입력은 보관했어요. 범위 입력을 비운 뒤 자료 연결을 새로 확인해 주세요."); }
      setData(next);
      if (id !== data.unitId) { applyView(null); setSelectedLinks([]); setTimes({ available: "", questions: "", practice: "" }); setSourceReady(false); setStep("unit"); selection.current={unitId:id,scopeId:null}; }
      else selection.current={...selection.current,unitId:id}; setNeedsRefresh(false); } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); } finally { setWorking(false); } }
  async function refresh(id: string): Promise<void> {
    setWorking(true); setError("");
    try {
      const next = scopeViewReply.parse(await librarianJson(`/api/librarian?id=${encodeURIComponent(id)}`, { method: "GET" }));
      if (next.scope.input.id !== id) throw new Error("다른 범위의 응답은 적용하지 않았어요. 선택한 기록을 다시 확인해 주세요.");
      applyView(next); selection.current = { ...selection.current, scopeId: id }; setStep("review"); setNeedsRefresh(false);
      if (retryAction && "expectedVersion" in retryAction && retryAction.id === id && next.scope.version > retryAction.expectedVersion) { pending.current = null; setRetryAction(null); }
    } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); }
    finally { setWorking(false); }
  }
  async function submit(input: LibrarianAction): Promise<boolean> {
    if (busy) return false;
    if (pending.current && pending.current.body !== JSON.stringify(input)) { setError("결과가 미확정인 원래 요청을 먼저 확인해 주세요. 다른 내용으로 저장하지 않았어요."); return false; }
    setWorking(true); setError(""); const body = JSON.stringify(input); const key = pending.current?.body === body ? pending.current.key : crypto.randomUUID(); pending.current={ body,key };
    try {
      const raw = await librarianJson("/api/librarian",{ method: "POST",headers: { "content-type": "application/json","idempotency-key": key },body });
      if (input.action === "link") { setData(overviewReply.parse(raw)); setLinkDirty(false); setSourceReady(false); setLinkRevision((current): number => current + 1); setStep("range"); }
      else { const result = scopeViewReply.parse(raw); const expectedId: string = input.action === "start" ? input.input.id : input.id;
        if (result.scope.input.id !== expectedId) throw new Error("저장 응답의 범위가 달라요. 원래 요청의 결과를 다시 확인해 주세요.");
        applyView(result); selection.current={...selection.current,scopeId:result.scope.input.id}; setData((current) => ({ ...current,history: [{ id: result.scope.input.id,version: result.scope.version,title: result.scope.unit.title,date: result.scope.input.date,phase: result.scope.phase },...current.history.filter((item): boolean => item.id !== result.scope.input.id)] })); }
      if (input.action !== "link") { setStep("review"); if (input.action === "start") { setScopeDirty(false); newId.current = crypto.randomUUID(); const url = new URL(window.location.href); url.search = new URLSearchParams({ id: input.input.id }).toString(); window.history.replaceState(window.history.state, "", url); } }
      pending.current=null; setRetryAction(null); setNeedsRefresh(false); return true;
    } catch (cause: unknown) {
      if (!(cause instanceof Error)) throw cause; setError(cause.message);
      if (cause instanceof LibrarianRequestError && cause.status >= 400 && cause.status < 500) {
        pending.current = null; setRetryAction(null); if (cause.status === 409) setNeedsRefresh(true);
        if (cause.status === 401 || cause.status === 403) setCovered(true);
      } else setRetryAction(input);
      return false;
    } finally { setWorking(false); }
  }
  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!unit) return; const fields=new FormData(event.currentTarget);
    const parsed=scopeInput.safeParse({ id: newId.current,planVersionId: unit.planVersionId,unitId: unit.unitId,date: formText(fields,"date"),availableMinutes: Number(formText(fields,"available")),questionMinutes: Number(formText(fields,"questions")),practiceMinutes: Number(formText(fields,"practice")),linkIds: fields.getAll("links"), ...(formText(fields,"levelStatement").trim() ? { levelStatement: formText(fields,"levelStatement") } : {}) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    await submit({ action: "start",input: parsed.data });
  }
  return <>{covered && <section aria-label="자료 접근 확인"><p role="status">원문을 가리고 로그인과 인출 상태를 다시 확인해요. 작성 중인 입력은 보관돼요.</p>{error && <p role="alert">{error}</p>}<button disabled={checking} onClick={(): void => { void restore(); }}>자료 접근 다시 확인</button></section>}
    <div className="library-content" hidden={covered} style={covered ? {display:"none"} : undefined} inert={!ready || covered}>
      <LibrarySteps step={step} ready={{ hasUnit: unit !== undefined, hasRange: sourceReady, hasLinks: data.links.length > 0, hasRecord: view !== null }} busy={requestBusy || retryAction !== null} onStep={setStep} />
      <h2 ref={stepHeading} tabIndex={-1} className="library-step-heading">{librarySteps.find((item): boolean => item.id === step)?.label}</h2>
      {error && <p role="alert" className="library-warning">{error}</p>}{requestBusy && <p role="status">저장된 자료와 범위를 확인하고 있어요.</p>}
      {retryAction && <aside className="library-warning" aria-label="미확정 저장 요청"><p>응답을 확인하지 못했어요. 입력을 보관하고 원래 내용과 요청 번호로 결과를 다시 확인해요.</p><button type="button" disabled={busy} onClick={(): void => { void submit(retryAction); }}>같은 요청 결과 다시 확인</button>{"expectedVersion" in retryAction && <button type="button" disabled={busy} onClick={(): void => { void refresh(retryAction.id); }}>요청한 범위의 저장 상태 읽기</button>}</aside>}
      {needsRefresh && <aside className="library-warning"><p>버전이나 근거가 달라졌어요. 최신 기록을 읽은 뒤 다시 검토해 주세요.</p><button type="button" disabled={busy} onClick={(): void => { if (view) void refresh(view.scope.input.id); else if (unit) void reload(unit.unitId); }}>최신 기록과 선택 다시 확인</button></aside>}
      {dirty && <aside className="library-warning" aria-label="저장하지 않은 범위 입력"><p>입력을 이 화면에 보관하고 있어요. 단원·기록 변경이나 새로고침 전에 저장해 주세요.</p>{linkDirty && <button type="reset" form="library-link-input" disabled={locked}>자료 연결 입력 비우기</button>}{scopeDirty && <button type="reset" form="library-scope-input" disabled={locked}>범위 입력 비우기</button>}</aside>}
      {unit && <p className="library-selected-unit"><strong>{step === "review" && view ? "검토 기록의 단원" : "선택한 단원"}</strong> {step === "review" && view ? view.scope.unit.title : unit.title}</p>}
      {data.units.length === 0 ? <p>먼저 <a href="/learn/advisor">진단과 학습계획</a>에서 계획을 확정해 주세요.</p> : <>
        <section hidden={step !== "unit"} aria-label="단원 선택 단계"><label>확정 계획의 단원<select value={data.unitId ?? ""} disabled={locked || dirty} onChange={(event): void => { void reload(event.target.value); }}>{orderUnitOptions(data.units,data.states).map((option): ReactElement => <option key={option.unit.unitId} value={option.unit.unitId}>{option.unit.title} · {option.progress.progress}{!option.available ? " · 확인 필요" : ""}</option>)}</select></label>{unit && <><p>{unit.objective}</p><UnitRequirements unit={unit} units={data.units} states={data.states} /><button type="button" disabled={locked} onClick={(): void => setStep("material")}>이 단원의 자료 고르기</button></>}</section>
        {unit && <>
          <section hidden={step !== "material" && step !== "range"} aria-label="자료와 구간 연결 단계">
            <div hidden={step !== "material"}><p>새 자료에서 확인 구간을 연결하거나, 이미 연결한 구간으로 이어가세요.</p>{data.links.length > 0 && <button type="button" disabled={locked} onClick={(): void => setStep("range")}>이미 연결한 구간 고르기</button>}</div>
            <MaterialLinkForm key={`${unit.unitId}:${linkRevision}`} unit={unit} library={data.library} busy={locked} covered={covered} submit={submit} step={step} onStep={setStep} onSourceReady={setSourceReady} onLoading={setSourceLoading} onDirty={setLinkDirty} />
          </section>
          <form id="library-scope-input" onSubmit={start} onChange={(event): void => { const fields = new FormData(event.currentTarget); setScopeDirty(true); setTimes({ available: formText(fields, "available"), questions: formText(fields, "questions"), practice: formText(fields, "practice") }); }} onReset={(): void => { setScopeDirty(false); setSelectedLinks([]); setTimes({ available: "", questions: "", practice: "" }); }} className="library-form" key={unit.unitId}>
            <section hidden={step !== "range"} aria-label="비교할 구간 선택 단계"><h3>단원에 연결한 구간</h3><button type="button" disabled={locked} onClick={(): void => { void reload(unit.unitId); }}>자료 연결 새로 확인</button>{materialIssues(data.links).map((issue,index): ReactElement => <p key={index} className="library-warning">{issue.action}</p>)}
              <CandidateChoices candidates={data.links} selected={selectedLinks} busy={locked} onSelect={(id, checked): void => setSelectedLinks((current): readonly string[] => changeSelection(current, id, checked))} />
              <ActionButton id="library-range-next" type="button" tone="primary" availability={locked ? { kind: "busy", reason: "자료를 확인하고 있어요." } : selectedLinks.length === 0 ? { kind: "blocked", reason: "비교할 자료를 한 개 이상 선택해 주세요." } : { kind: "available" }} onClick={(): void => setStep("time")}>시간 정하기 · 자료 {selectedLinks.length}개</ActionButton>
            </section>
            <section hidden={step !== "time"} aria-label="학습 시간 입력 단계"><label>오늘의 학습 수준·가정 (선택)<textarea name="levelStatement" maxLength={2000} disabled={locked} placeholder="예: 처음 배우는 단계예요. 검증용 합성 입력이면 그 사실과 가정한 수준을 함께 적어 주세요." /></label><p>비워 두면 확정 계획의 자기 보고를 사용해요. 이 입력으로 실제 수행 수준을 확정하지 않아요.</p><label>학습 날짜<input name="date" type="date" defaultValue={data.today} required disabled={locked} /></label><div className="library-times"><label>가용 시간 (분)<input name="available" type="number" min={1} max={240} required disabled={locked} /></label><label>질문·인출 시간 (분)<input name="questions" type="number" min={1} max={120} required disabled={locked} /></label><label>직접 수행 시간 (분)<input name="practice" type="number" min={1} max={120} required disabled={locked} /></label></div><DraftScopeTiming candidates={data.links} selected={selectedLinks} times={times} /><p>선택 구간을 자동으로 자르지 않아요. 시간이 부족하면 더 작은 확인 구간을 직접 연결해 주세요.</p><button disabled={locked || needsRefresh || selectedLinks.length === 0}>비교할 자료와 시간 저장</button>{selectedLinks.length === 0 && <p>페이지·구간 단계에서 비교할 자료를 먼저 선택해 주세요.</p>}</section>
          </form>
        </>}
      </>}
      {data.history.length > 0 && <label>학습 범위 기록<select value={view?.scope.input.id ?? ""} disabled={locked || dirty} onChange={(event): void => { const target = new URL(window.location.href); target.search = new URLSearchParams({ id: event.target.value }).toString(); target.hash = "scope-setup"; window.location.assign(target.href); }}><option value="" disabled>기록 선택</option>{data.history.map((item): ReactElement => <option key={item.id} value={item.id}>{item.date} · {item.title} · {item.phase === "confirmed" ? "확정" : "진행 중"}</option>)}</select></label>}
      <section hidden={step !== "review"} aria-label="학습 범위 검토 단계">{view && !covered && <ScopeDetail key={`${view.scope.input.id}:${view.scope.version}`} view={view} units={data.units} busy={busy} blocked={locked || needsRefresh} onReselect={(): void => setStep("unit")} submit={submit} refresh={refresh} />}</section>
    </div>
  </>;
}
