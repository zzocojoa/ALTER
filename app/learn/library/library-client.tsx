"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactElement } from "react";
import type { LibrarianOverview } from "@/lib/librarian/server";
import { scopeInput } from "@/lib/librarian/contracts";
import type { LibrarianAction } from "@/lib/librarian/request";
import { orderUnitOptions } from "@/lib/librarian/range";
import { materialIssues } from "@/lib/librarian/issues";
import { subscribeToHydration, clientReady, serverReady } from "@/lib/client-ready";
import { formText, librarianJson, overviewReply, scopeViewReply } from "./client-api";
import type { ScopeView } from "./client-api";
import { MaterialLinkForm } from "./link-form";
import { ScopeDetail } from "./scope-detail";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";

export function LibrarianClient({ initial, initialView }: Readonly<{ initial: LibrarianOverview; initialView: ScopeView | null }>): ReactElement {
  const [data,setData] = useState<LibrarianOverview>(initial); const [view,setView] = useState<ScopeView | null>(initialView); const [working,setWorking] = useState<boolean>(false); const [error,setError] = useState<string>("");
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
      setData(nextData); setView(nextView); setCovered(false);
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
  const ready = useSyncExternalStore(subscribeToHydration,clientReady,serverReady); const busy: boolean = working || checking || !ready;
  const pending = useRef<Readonly<{ body: string; key: string }> | null>(null); const newId = useRef<string>(crypto.randomUUID());
  const unit = data.units.find((item): boolean => item.unitId === data.unitId);
  async function reload(id: string): Promise<void> { setWorking(true); setError(""); try { setData(overviewReply.parse(await librarianJson(`/api/librarian?unit=${encodeURIComponent(id)}`,{ method: "GET" }))); selection.current={...selection.current,unitId:id}; } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); } finally { setWorking(false); } }
  async function refresh(id: string): Promise<void> { setWorking(true); setError(""); try { setView(scopeViewReply.parse(await librarianJson(`/api/librarian?id=${encodeURIComponent(id)}`,{ method: "GET" }))); selection.current={...selection.current,scopeId:id}; } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); } finally { setWorking(false); } }
  async function submit(input: LibrarianAction): Promise<boolean> {
    if (busy) return false; setWorking(true); setError(""); const body = JSON.stringify(input); const key = pending.current?.body === body ? pending.current.key : crypto.randomUUID(); pending.current={ body,key };
    try {
      const raw = await librarianJson("/api/librarian",{ method: "POST",headers: { "content-type": "application/json","idempotency-key": key },body });
      if (input.action === "link") setData(overviewReply.parse(raw));
      else { const result = scopeViewReply.parse(raw); setView(result); selection.current={...selection.current,scopeId:result.scope.input.id}; setData((current) => ({ ...current,history: [{ id: result.scope.input.id,version: result.scope.version,title: result.scope.unit.title,date: result.scope.input.date,phase: result.scope.phase },...current.history.filter((item): boolean => item.id !== result.scope.input.id)] })); }
      pending.current=null; return true;
    } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; setError(cause.message); return false; } finally { setWorking(false); }
  }
  async function start(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!unit) return; const fields=new FormData(event.currentTarget);
    const parsed=scopeInput.safeParse({ id: newId.current,planVersionId: unit.planVersionId,unitId: unit.unitId,date: formText(fields,"date"),availableMinutes: Number(formText(fields,"available")),questionMinutes: Number(formText(fields,"questions")),practiceMinutes: Number(formText(fields,"practice")),linkIds: fields.getAll("links"), ...(formText(fields,"levelStatement").trim() ? { levelStatement: formText(fields,"levelStatement") } : {}) });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (await submit({ action: "start",input: parsed.data })) newId.current=crypto.randomUUID();
  }
  return <>{covered && <section aria-label="자료 접근 확인"><p role="status">원문을 가리고 로그인과 인출 상태를 다시 확인해요. 작성 중인 입력은 보관돼요.</p>{error && <p role="alert">{error}</p>}<button disabled={checking} onClick={()=>void restore()}>자료 접근 다시 확인</button></section>}<div className="library-content" hidden={covered} style={covered ? {display:"none"} : undefined} inert={!ready || covered}>{error && <p role="alert" className="library-warning">{error}</p>}{busy && <p role="status">저장된 자료와 범위를 확인하고 있어요.</p>}{data.units.length === 0 ? <p>먼저 <a href="/learn/advisor">진단과 학습계획</a>에서 계획을 확정해 주세요.</p> : <><label>확정 계획의 단원<select value={data.unitId ?? ""} disabled={busy} onChange={(event): void => { void reload(event.target.value); }}>{orderUnitOptions(data.units,data.states).map((option) => <option key={option.unit.unitId} value={option.unit.unitId}>{option.unit.title} · {option.progress.progress}{!option.available ? " · 확인 필요" : ""}</option>)}</select></label>{unit && <><p>{unit.objective}</p><p>선행 단원: {unit.prerequisiteUnitIds.map((id): string => data.units.find((item): boolean => item.unitId === id)?.title ?? "확인 필요").join(", ") || "없음"}</p><MaterialLinkForm key={unit.unitId} unit={unit} library={data.library} busy={busy} covered={covered} submit={submit} /><section><h2>단원에 연결한 자료</h2><button disabled={busy} onClick={(): void => { void reload(unit.unitId); }}>자료 연결 새로 확인</button>{materialIssues(data.links).map((issue,index) => <p key={index} className="library-warning">{issue.action}</p>)}<form onSubmit={start} className="library-form" key={unit.unitId}><fieldset><legend>비교할 자료 선택 (최대 12개)</legend>{data.links.map((candidate) => <label key={candidate.link.id} className="library-check"><input type="checkbox" name="links" value={candidate.link.id} /><span>{candidate.link.metadata.title} · {candidate.link.metadata.edition || "판본 미입력"} · {candidate.link.toc} · 읽기 {candidate.link.readingMinutes}분 · {candidate.valid ? "본문 확인됨" : "본문 재확인"}</span></label>)}</fieldset><label>오늘의 학습 수준·가정 (선택)<textarea name="levelStatement" maxLength={2000} placeholder="예: 처음 배우는 단계예요. 검증용 합성 입력이면 그 사실과 가정한 수준을 함께 적어 주세요." /></label><p>비워 두면 확정 계획의 자기 보고를 사용해요. 이 입력으로 실제 수행 수준을 확정하지 않아요.</p><label>학습 날짜<input name="date" type="date" defaultValue={data.today} required /></label><div className="library-times"><label>가용 시간 (분)<input name="available" type="number" min={1} max={240} required /></label><label>질문·인출 시간 (분)<input name="questions" type="number" min={1} max={120} required /></label><label>직접 수행 시간 (분)<input name="practice" type="number" min={1} max={120} required /></label></div><p>선택 구간을 자동으로 자르지 않아요. 시간이 부족하면 더 작은 확인 구간을 직접 연결해 주세요.</p><button disabled={busy || data.links.length === 0}>비교할 자료와 시간 저장</button></form></section></> }</>}
    {data.history.length > 0 && <label>학습 범위 기록<select value={view?.scope.input.id ?? ""} disabled={busy} onChange={(event): void => { void refresh(event.target.value); }}><option value="" disabled>기록 선택</option>{data.history.map((item) => <option key={item.id} value={item.id}>{item.date} · {item.title} · {item.phase === "confirmed" ? "확정" : "진행 중"}</option>)}</select></label>}{view && !covered && <ScopeDetail key={`${view.scope.input.id}:${view.scope.version}`} view={view} busy={busy} submit={submit} refresh={refresh} />}
  </div></>;
}
