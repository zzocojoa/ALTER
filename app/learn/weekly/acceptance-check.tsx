"use client";
import { useRouter } from "next/navigation";
import { useState,useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { weeklyView } from "@/lib/weekly/view";
import type { WeeklyView } from "@/lib/weekly/view";
import { subscribeToHydration,clientReady,serverReady } from "@/lib/client-ready";
import { librarianJson } from "../library/client-api";
const reply=z.object({view:weeklyView.nullable()}).strict();
export function WeeklyAcceptanceCheck():ReactElement {
  const router=useRouter();const ready=useSyncExternalStore(subscribeToHydration,clientReady,serverReady);const [view,setView]=useState<WeeklyView|null>(null);const [checked,setChecked]=useState<boolean>(false);const [busy,setBusy]=useState<boolean>(false);const [error,setError]=useState<string>("");
  async function run(action:string):Promise<void>{setBusy(true);setError("");try{const value=await librarianJson("/api/weekly/acceptance",action==="read" ? {method:"GET"} : {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,expectedVersion:view?.state.version ?? 1})});const next=reply.parse(value).view;setView(next);setChecked(true);if(next && action!=="read") {router.push(`/learn/weekly?id=${next.state.id}`);router.refresh();}}catch(cause:unknown){if(!(cause instanceof Error)) throw cause;setError(cause.message);}finally{setBusy(false);}}
  return <details className="storage-check" inert={!ready}><summary>Task 13 고정 주간 검증</summary><p>승인된 분수 시험 회차와 가용 60분만 사용해요. 기존 검증·재시도를 합친 승인된 누적 검증 한도 안에서 실행하며 추가 충전 없이 원화 대사는 미확정으로 유지해요.</p><p><a href="/learn?check=budget#check-budget">현재 검증 한도와 누적 사용량 확인</a></p><button disabled={busy} onClick={()=>void run("read")}>시험 주간 기록 확인</button>{checked && !view && <button disabled={busy} onClick={()=>void run("prepare")}>고정 주간 시험 준비</button>}{view && <><p role="status">시험 주간 {view.state.version}판 · {view.state.phase}</p>{view.state.pendingKey ? <button disabled={busy} onClick={()=>void run("recover")}>기존 주간 AI 결과 확인</button> : view.state.proposal ? <a href={`/learn/weekly?id=${view.state.id}`}>시험 주간 초안 보기</a> : <button disabled={busy} onClick={()=>void run("generate")}>고정 주간 AI 제안 생성</button>}</>}{error && <p role="alert">{error}</p>}</details>;
}
