"use client";
import { useCallback,useEffect,useRef,useState } from "react";
import type { ReactElement } from "react";
import { resultDraft } from "@/lib/results/contracts";
import type { ResultDraft,ResultRequest } from "@/lib/results/contracts";
import { ResultPanel } from "./result-panel";
type Pending=Readonly<{body:string;key:string}>;
export function ResultClient({initial}:Readonly<{initial:ResultDraft}>):ReactElement {
  const [draft,setDraft]=useState<ResultDraft>(initial);const [busy,setBusy]=useState<boolean>(false);const [error,setError]=useState<string>("");const [uncertain,setUncertain]=useState<boolean>(false);const [covered,setCovered]=useState<boolean>(false);const pending=useRef<Pending|null>(null);const inFlight=useRef<boolean>(false);
  const refresh=useCallback(async ():Promise<void>=>{
    if(inFlight.current) return;inFlight.current=true;setBusy(true);setError("");
    try {const response=await fetch(`/api/results?id=${encodeURIComponent(initial.id)}`,{cache:"no-store"});if(!response.ok) throw new Error(`최신 기록 조회 실패 (HTTP ${response.status}). 로그인과 기록 상태를 확인하세요.`);const next=resultDraft.parse(await response.json());setDraft(next);setCovered(false);if(next.confirmation){pending.current=null;setUncertain(false);}}
    catch(cause:unknown){if(!(cause instanceof Error)) throw cause;setError(cause.message);}finally{inFlight.current=false;setBusy(false);}
  },[initial.id]);
  useEffect(()=>{function hide():void{setCovered(true);}function show():void{void refresh();}window.addEventListener("pagehide",hide);window.addEventListener("pageshow",show);return ():void=>{window.removeEventListener("pagehide",hide);window.removeEventListener("pageshow",show);};},[refresh]);
  async function confirm():Promise<void> {
    if(inFlight.current) return;inFlight.current=true;setBusy(true);setError("");
    const input:ResultRequest={id:draft.id,expectedVersion:draft.version,expectedSessionVersion:draft.sessionVersion,expectedOfficialVersion:draft.officialVersion,fingerprint:draft.fingerprint};const attempt=pending.current ?? {body:JSON.stringify(input),key:crypto.randomUUID()};pending.current=attempt;
    try {const response=await fetch("/api/results",{method:"POST",headers:{"content-type":"application/json","idempotency-key":attempt.key},body:attempt.body});if(!response.ok){const payload=await response.json() as {error?:string};if(response.status<500){pending.current=null;setUncertain(false);throw new Error(payload.error==="request_key_reused" ? "요청 키의 내용이 달라요. 최신 기록을 조회하고 다시 확인하세요." : "기록 버전이나 근거가 바뀌었어요. 최신 기록을 조회한 뒤 다시 확인하세요.");}throw new Error("확정 요청의 처리 결과를 확인하지 못했어요.");}setDraft(resultDraft.parse(await response.json()));pending.current=null;setUncertain(false);}
    catch(cause:unknown){if(!(cause instanceof Error)) throw cause;setError(cause.message);setUncertain(pending.current!==null);}finally{inFlight.current=false;setBusy(false);}
  }
  return covered ? <section><p>서버에서 로그인과 최신 기록을 다시 확인하고 있어요.</p>{error && <p role="alert">{error}</p>}<button onClick={()=>void refresh()}>다시 확인</button></section> : <ResultPanel draft={draft} busy={busy} uncertain={uncertain} error={error} onConfirm={confirm} onRefresh={refresh}/>;
}
