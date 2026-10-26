"use client";
import { useCallback,useEffect,useState } from "react";
import type { ReactElement } from "react";
import { librarianJson } from "../library/client-api";
/** 화면에 나타난 뒤 수신 사실만 별도로 남기며 실패해도 도움 사용을 취소하지 않습니다. */
export function HelpDelivery({sessionId,helpId}:Readonly<{sessionId:string;helpId:string}>):ReactElement {
  const [state,setState]=useState<"pending"|"confirmed"|"failed">("pending");const [error,setError]=useState<string>("");
  const send=useCallback(async ():Promise<void>=>{await librarianJson("/api/tutor/delivery",{method:"POST",headers:{"content-type":"application/json","idempotency-key":helpId},body:JSON.stringify({id:sessionId,helpId})});},[sessionId,helpId]);
  const confirmed=useCallback(():void=>setState("confirmed"),[]);
  const failed=useCallback((cause:unknown):void=>{if(!(cause instanceof Error)) throw cause;setError(cause.message);setState("failed");},[]);
  useEffect(()=>{let active=true;void send().then(()=>{if(active) confirmed();},(cause:unknown)=>{if(active) failed(cause);});return ():void=>{active=false;};},[send,confirmed,failed]);
  return <p role="status">{state==="confirmed" ? "도움 화면 수신 확인됨" : state==="pending" ? "도움 사용은 저장되었고 화면 수신을 확인하고 있어요." : <>도움 사용은 저장되었지만 화면 수신 기록을 확인하지 못했어요. {error}<button onClick={():void=>{void send().then(confirmed,failed);}}>수신 기록 다시 확인</button></>}</p>;
}
