"use client";
import { GoogleReportPreview } from "./google-report-preview";
import { WeeklyEvidence } from "./weekly-evidence";
import { StatusBadge } from "@/components/alter/status";
import { ServiceFailureHelp } from "../service-availability";
import { useCallback,useEffect,useRef,useState,useSyncExternalStore } from "react";
import type { FormEvent,ReactElement } from "react";
import { sendGoogleWeeklyReport } from "@/lib/google-report/client";
import { GoogleReportStatus } from "./google-report-status";
import { weeklyBusinessKey } from "@/lib/weekly/confirmation";
import { weeklyAction } from "@/lib/weekly/request";
import type { WeeklyAction } from "@/lib/weekly/request";
import { weeklyView } from "@/lib/weekly/view";
import type { WeeklyView } from "@/lib/weekly/view";
import type { WeeklyOverview } from "@/lib/weekly/server";
import type { WeeklyEdit } from "@/lib/weekly/workspace";
import { subscribeToHydration,clientReady,serverReady } from "@/lib/client-ready";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";
import { useDraftNavigation } from "@/lib/use-draft-navigation";
import { WeeklyEditor } from "./weekly-editor";

type Pending=Readonly<{body:string;key:string}>;
type DraftEdits=Readonly<{editor:boolean;start:boolean;time:boolean}>;
const cleanDrafts:DraftEdits={editor:false,start:false,time:false};
const conflictMessage:string="서버에 새 주간 기록이 있어요. 작성 중인 입력은 이 화면에 보관했고 덮어쓰지 않았어요. 내용을 별도로 보관하거나 검토한 뒤 ‘작성 중 입력 버리고 최신 기록 읽기’를 선택해 주세요.";
export function WeeklyClient({overview,initial}:Readonly<{overview:WeeklyOverview;initial:WeeklyView|null}>):ReactElement {
  const ready=useSyncExternalStore(subscribeToHydration,clientReady,serverReady);
  const [edits,setEdits]=useState<DraftEdits>(cleanDrafts);const draftEdits=useRef<DraftEdits>(cleanDrafts);const editRevision=useRef<number>(0);
  const [timeText,setTimeText]=useState<string>(initial?.state.context.availableMinutes?.toString() ?? "");
  const [view,setView]=useState<WeeklyView|null>(initial);const current=useRef<WeeklyView|null>(initial);
  const [working,setBusy]=useState<boolean>(false);const [error,setError]=useState<string>("");const [uncertain,setUncertain]=useState<boolean>(false);const [covered,setCovered]=useState<boolean>(false);const concealed=useRef<boolean>(false);
  const [conflicted,setConflicted]=useState<boolean>(false);const [formRevision,setFormRevision]=useState<number>(0);
  const pending=useRef<Pending|null>(null);const mutation=useRef<boolean>(false);const selected=useRef<string|null>(initial?.state.id ?? null);
  const request=useRef<AbortController|null>(null);const generation=useRef<number>(0);
  const [reportMessage,setReportMessage]=useState<string>("");const [reportRefresh,setReportRefresh]=useState<number>(0);
  const dirty:boolean=edits.editor || edits.start || edits.time;const busy:boolean=working || !ready;
  const accept=useCallback((next:WeeklyView|null):void=>{current.current=next;setView(next);},[]);
  const refresh=useCallback(async():Promise<void>=>{
    if(mutation.current) return;
    request.current?.abort();const controller=new AbortController();request.current=controller;const reading=++generation.current;const id=selected.current;
    setBusy(true);setError("");concealed.current=true;setCovered(true);
    try {
      const response=await fetch(id ? `/api/weekly?id=${encodeURIComponent(id)}` : "/api/weekly",{cache:"no-store",signal:controller.signal});
      if(!response.ok) throw new Error(`최신 기록 조회 실패 (HTTP ${response.status}). 로그인과 인출 상태를 확인해 주세요.`);
      const next=id ? weeklyView.parse(await response.json()) : null;
      if(controller.signal.aborted || reading!==generation.current) return;
      const previous=current.current;if(previous && next && previous.state.id===next.state.id && next.state.version<previous.state.version)throw new Error("서버에서 이전 주간 버전을 반환했어요. 작성한 입력은 보관했으니 다시 확인해 주세요.");const local=draftEdits.current;const hasDraft=local.editor || local.start || local.time;
      if(hasDraft && previous?.state.id===next?.state.id && previous?.state.version!==next?.state.version){setConflicted(true);setError(conflictMessage);}
      else if(hasDraft && previous?.state.id!==next?.state.id){setConflicted(true);setError(conflictMessage);}
      else {accept(next);if(!local.time)setTimeText(next?.state.context.availableMinutes?.toString() ?? "");if(!hasDraft)setConflicted(false);}
      window.history.replaceState(null,"",id ? `/learn/weekly?id=${id}` : "/learn/weekly");
      concealed.current=false;setCovered(false);
    }catch(cause:unknown){if(controller.signal.aborted || reading!==generation.current) return;if(!(cause instanceof Error)) throw cause;setError(cause.message);}
    finally{if(reading===generation.current)setBusy(false);}
  },[accept]);
  useEffect(()=>{
    function hide():void{request.current?.abort();generation.current++;concealed.current=true;setCovered(true);if(!mutation.current)setBusy(false);}
    function show():void{if(document.visibilityState==="visible") void refresh();}
    function visibility():void{if(document.visibilityState==="hidden") hide();else show();}
    document.addEventListener("visibilitychange",visibility);window.addEventListener("pagehide",hide);window.addEventListener("pageshow",show);window.addEventListener(RECALL_START_EVENT,hide);
    return()=>{request.current?.abort();document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",hide);window.removeEventListener("pageshow",show);window.removeEventListener(RECALL_START_EVENT,hide);};
  },[refresh]);
  function markEditor():void{draftEdits.current={...draftEdits.current,editor:true};editRevision.current++;setEdits(draftEdits.current);}
  function markStart():void{draftEdits.current={...draftEdits.current,start:true};editRevision.current++;setEdits(draftEdits.current);}
  function markTime():void{draftEdits.current={...draftEdits.current,time:true};editRevision.current++;setEdits(draftEdits.current);}
  const keepBeforeLeave=useCallback(async():Promise<boolean>=>{setError("작성한 주간 입력을 먼저 저장하거나 명시적으로 버린 뒤 이동해 주세요. 입력은 이 화면에 보관돼요.");return false;},[]);
  useDraftNavigation({dirty,busy,save:keepBeforeLeave,onError:setError});
  async function discard():Promise<void>{if(mutation.current || pending.current)return;draftEdits.current=cleanDrafts;setEdits(cleanDrafts);editRevision.current++;setConflicted(false);setFormRevision(value=>value+1);await refresh();}
  async function send(attempt:Pending):Promise<void>{
    if(mutation.current)return;request.current?.abort();generation.current++;mutation.current=true;setBusy(true);setError("");pending.current=attempt;
    const savingRevision=editRevision.current;const input=weeklyAction.parse(JSON.parse(attempt.body));
    try {
      const response=await fetch("/api/weekly",{method:"POST",headers:{"content-type":"application/json","idempotency-key":attempt.key},body:attempt.body});
      if(!response.ok){const payload=await response.json() as {message?:string};if(response.status<500){pending.current=null;setUncertain(false);}throw new Error(payload.message ?? `주간 초안 요청 실패 (HTTP ${response.status})`);}
      const next=weeklyView.parse(await response.json());
      if(editRevision.current!==savingRevision){setConflicted(true);setError(conflictMessage);}else{accept(next);const remaining={...draftEdits.current,...(input.action==="save" ? {editor:false} : input.action==="start" ? {start:false} : input.action==="time" ? {time:false} : {})};draftEdits.current=remaining;setEdits(remaining);if(!remaining.time)setTimeText(next.state.context.availableMinutes?.toString() ?? "");setConflicted(false);}
      selected.current=next.state.id;window.history.replaceState(null,"",`/learn/weekly?id=${next.state.id}`);pending.current=null;setUncertain(false);
      if(input.action==="confirm" && next.state.confirmedVersionId){try{await sendGoogleWeeklyReport(next.state.confirmedVersionId,setReportMessage);}catch(reportError:unknown){if(!(reportError instanceof Error))throw reportError;setReportMessage(`내부 확정본은 저장됐어요. Google 연동: ${reportError.message}`);}finally{setReportRefresh(value=>value+1);}}
    }catch(cause:unknown){if(!(cause instanceof Error))throw cause;setError(cause.message);setUncertain(pending.current!==null);}
    finally{mutation.current=false;setBusy(false);if(concealed.current && document.visibilityState==="visible")void refresh();}
  }
  async function act(input:WeeklyAction):Promise<void>{
    if(pending.current){setError("먼저 같은 요청의 처리 결과를 확인해 주세요.");return;}
    if(conflicted){setError(conflictMessage);return;}
    const local=draftEdits.current;
    const otherDraft=input.action==="save" ? false : input.action==="start" ? local.editor || local.time : input.action==="time" ? local.editor : local.editor || local.start || local.time;
    if(otherDraft){setError("다른 입력란에 작성 중인 내용이 있어요. 먼저 저장하거나 명시적으로 버린 뒤 진행해 주세요.");return;}
    await send({body:JSON.stringify(input),key:crypto.randomUUID()});
  }
  function start(event:FormEvent<HTMLFormElement>):void{event.preventDefault();const data=new FormData(event.currentTarget);try{const input=weeklyAction.parse({action:"start",input:{id:crypto.randomUUID(),courseId:data.get("course"),date:data.get("date"),availableMinutes:data.get("time")==="" ? null : Number(data.get("time"))}});void act(input);}catch(cause:unknown){if(!(cause instanceof Error))throw cause;setError("과정·날짜·가용 시간을 확인해 주세요.");}}
  async function save(input:WeeklyEdit):Promise<void>{if(!view)throw new Error("주간 초안을 먼저 선택해 주세요.");await act({action:"save",id:view.state.id,expectedVersion:view.state.version,input});}
  const state=view?.state;const unavailable=busy || uncertain || conflicted || !view?.current || state?.phase==="generating";
  return <>{covered && <section><p>로그인과 인출 상태를 서버에서 다시 확인하고 있어요. 작성 중인 입력은 보관돼요.</p>{error && <><p role="alert">{error}</p><ServiceFailureHelp/></>}<button disabled={busy} onClick={()=>void refresh()}>다시 확인</button></section>}<div key={formRevision} className="weekly-workspace" hidden={covered} style={covered ? {display:"none"} : undefined} inert={!ready || covered} onClick={event=>{const link=event.target instanceof Element ? event.target.closest("a") : null;const href=link?.getAttribute("href");if(href?.startsWith("#weekly-answer-")){const details=document.getElementById(href.slice(1))?.closest("details");if(details) details.open=true;}}}>{error && <><p role="alert">{error}</p><ServiceFailureHelp/></>}{dirty && <button disabled={busy || uncertain} onClick={()=>void discard()}>작성 중 입력 버리고 최신 기록 읽기</button>}{uncertain && <button disabled={busy} onClick={()=>{if(pending.current) void send(pending.current);}}>같은 요청 처리 결과 확인</button>}<details open={!state}><summary>새 주간 점검</summary><form onSubmit={start} onChange={markStart}><fieldset disabled={busy || uncertain}><label>학습 과정<select name="course" required>{overview.courses.map(course=><option key={course.id} value={course.id}>{course.title}</option>)}</select></label><label>점검할 주간의 날짜<input name="date" type="date" required defaultValue={overview.today}/></label><label>다음 주 가용 시간 (분)<input name="time" type="number" min={0} max={10080} step={1}/></label><button disabled={overview.courses.length===0}>주간 기록 모으기</button></fieldset></form>{overview.courses.length===0 && <p>Advisor에서 학습계획을 먼저 확정해 주세요.</p>}</details><label>저장한 주간 기록<select value={state?.id ?? ""} disabled={busy || uncertain} onChange={event=>{if(dirty){setError("작성 중인 입력을 저장하거나 명시적으로 버린 뒤 다른 주간 기록을 선택해 주세요.");return;}selected.current=event.target.value || null;void refresh();}}><option value="">주간 기록 선택</option>{[...overview.history,...(state && !overview.history.some(item=>item.id===state.id) ? [{id:state.id,courseId:state.courseId,start:state.context.aggregate.period.start,end:state.context.aggregate.period.endExclusive,version:state.version}] : [])].map(item=><option key={item.id} value={item.id}>{item.start} 주간 · {overview.courses.find(course=>course.id===item.courseId)?.title ?? "학습 과정"}</option>)}</select></label>{state && view && <section aria-label="주간 점검 기록"><h2>{state.context.aggregate.period.start} 주간</h2><p>다음 주 {state.context.aggregate.period.endExclusive} 전까지 · 서울 시간 · 기록 {state.version}판 · {state.phase==="generating" ? "AI 결과 확인 중" : state.phase==="confirmed" ? "확정" : "초안"}</p><StatusBadge label={state.phase==="confirmed" ? "내부 확정본 저장됨" : state.phase==="generating" ? "AI 결과 확인 중 · 미확정" : "검토 중인 초안 · 미확정"} tone={state.phase==="confirmed" ? "success" : "neutral"}/>{!view.current && <p role="alert">현재 학습 근거와 달라 재검증이 필요해요. 저장·확정 버튼에서 조건을 확인해 주세요.</p>}{view.issue && <p role="alert">{view.issue}</p>}<button disabled={busy} onClick={()=>void refresh()}>최신 기록 읽기</button><button disabled={busy || uncertain || dirty || conflicted || state.phase==="generating"} onClick={()=>void act({action:"refresh",id:state.id,expectedVersion:state.version})}>근거 새로 읽고 초안 다시 준비</button><p>다시 준비하면 현재 초안의 제안은 비워져요. 내 메모와 이전 확정본은 보관돼요.</p><WeeklyEvidence aggregate={state.context.aggregate} covered={covered}/><form onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);void act({action:"time",id:state.id,expectedVersion:state.version,availableMinutes:Number(data.get("minutes"))});}}><label>다음 주 가용 시간 저장 (분)<input type="number" name="minutes" min={0} max={10080} step={1} required value={timeText} onChange={event=>{setTimeText(event.target.value);markTime();}} disabled={unavailable}/></label><button disabled={unavailable}>시간 저장</button></form>{state.phase==="generating" ? <><button disabled={busy || uncertain || dirty} onClick={()=>void act({action:"recover",id:state.id,expectedVersion:state.version})}>기존 AI 결과 확인</button><p>{view.generationRecovery.reason}</p>{view.generationRecovery.allowed && <><button disabled={busy || uncertain || dirty} onClick={()=>void act({action:"reset-generation",id:state.id,expectedVersion:state.version})}>AI 제안 비우고 초안 다시 열기</button><p>이전 AI 제안은 비워요. 내 메모·실패 이력·사용량·이미 저장한 확정본은 보관하고, 현재 학습 기록으로 초안을 다시 열어요. 새 AI 호출은 하지 않아요.</p></>}</> : <button disabled={unavailable || dirty || state.context.availableMinutes===null} onClick={()=>void act({action:"generate",id:state.id,expectedVersion:state.version})}>주간 요약·다음 주 제안 생성</button>}<p>AI 제안은 예상이며 확정된 성과를 새로 만들지 않아요.</p><WeeklyEditor key={`${state.id}:${state.version}`} state={state} disabled={unavailable} covered={covered} onSave={save} onError={setError} onDirty={markEditor}/>{dirty && <p role="status">수정한 내용을 먼저 저장해 주세요.</p>}<GoogleReportPreview state={state} dirty={dirty} covered={covered}/><button disabled={unavailable || dirty || state.phase!=="proposed"} onClick={()=>void act({action:"confirm-local",id:state.id,expectedVersion:state.version,businessKey:weeklyBusinessKey(state),fingerprint:state.fingerprint})}>이 주간 내용만 확정</button><p>ALTER 안에 확정본을 저장해요. Google로 보내려면 아래 내보내기를 선택하세요.</p><button disabled={unavailable || dirty || state.phase!=="proposed"} onClick={()=>void act({action:"confirm",id:state.id,expectedVersion:state.version,businessKey:weeklyBusinessKey(state),fingerprint:state.fingerprint})}>이 주간 내용 확정하고 내보내기 요청</button><p>Google 연결이 준비되면 확정 직후 Docs·Sheets 저장과 재조회 검증을 진행해요. 내부 확정본은 연동 결과와 별도로 보관해요.</p>{reportMessage&&<p role="status">{reportMessage}</p>}{state.confirmedVersionId&&<GoogleReportStatus key={state.confirmedVersionId} versionId={state.confirmedVersionId} disabled={busy||uncertain||covered} refreshToken={reportRefresh}/>}{view.versions.length>0 && <details><summary>보관된 확정본 ({view.versions.length})</summary>{view.versions.map(version=><p key={version.id}><a href={`/learn/weekly/version?id=${version.id}`}>확정 {version.ordinal}판 읽기</a> · {version.exportState==="complete" ? "연동 완료" : "연동 결과 확인"}</p>)}</details>}{state.confirmedVersionId && <p><a href={`/learn/weekly/version?id=${state.confirmedVersionId}`}>저장한 확정본 읽기</a></p>}</section>}</div></>;
}
