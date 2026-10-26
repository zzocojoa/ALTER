"use client";
import { useRouter } from "next/navigation";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";
import { useState,useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import { tutorView } from "@/lib/tutor/view";
import type { TutorView } from "@/lib/tutor/view";
import { subscribeToHydration,clientReady,serverReady } from "@/lib/client-ready";
import { librarianJson } from "../library/client-api";
const reply=z.object({view:tutorView.nullable()}).strict();
export function ReviewAcceptanceCheck():ReactElement {
  const router=useRouter();
  const ready=useSyncExternalStore(subscribeToHydration,clientReady,serverReady);const [view,setView]=useState<TutorView|null>(null);const [checked,setChecked]=useState<boolean>(false);const [busy,setBusy]=useState<boolean>(false);const [error,setError]=useState<string>("");
  async function run(action:string):Promise<void>{setBusy(true);setError("");if(action==="prepare") window.dispatchEvent(new Event(RECALL_START_EVENT));try{const value=await librarianJson("/api/reviews/acceptance",action==="read" ? {method:"GET"} : {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,expectedVersion:view?.version ?? 1})});const next=reply.parse(value).view;setView(next);setChecked(true);if(action==="prepare" && next) router.push(`/learn/tutor?id=${next.id}`);}catch(cause:unknown){if(!(cause instanceof Error)) throw cause;setError(cause.message);}finally{setBusy(false);}}
  return <details className="storage-check" inert={!ready}><summary>Task 12 고정 복습 검증</summary><p>승인된 분수 시험 답안만 사용해요. 기존 검증·재시도 포함 승인된 누적 검증 한도이며 추가 충전 없이 원화 대사는 미확정으로 남겨요.</p><p><a href="/learn?check=budget#check-budget">현재 검증 한도와 누적 사용량 확인</a></p><button disabled={busy} onClick={():void=>{void run("read");}}>시험 복습 기록 확인</button>{checked && !view && <button disabled={busy} onClick={():void=>{void run("prepare");}}>고정 복습 시험 준비</button>}{view && <><p role="status">시험 복습 {view.version}판 · {view.phase}</p>{view.pending ? <button disabled={busy} onClick={():void=>{void run("recover");}}>기존 시험 AI 결과 확인</button> : <>{view.phase==="awaiting-answer" && <button disabled={busy} onClick={():void=>{void run("submit");}}>고정 복습 답안 저장</button>}{view.phase==="answer-saved" && <button disabled={busy} onClick={():void=>{void run("diagnose");}}>고정 복습 AI 진단</button>}{view.phase==="diagnosed" && <button disabled={busy} onClick={():void=>{void run("finish");}}>고정 복습 시험 마치기</button>}</>}{view.phase==="finished" && <a href={`/learn/results?id=${view.id}`}>시험 복습 결과 확인·확정</a>}<p>일반 복습 화면은 새로고침하면 저장된 회차를 표시해요.</p></>}{error && <p role="alert">{error}</p>}</details>;
}
