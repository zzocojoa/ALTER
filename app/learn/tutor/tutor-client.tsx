"use client";
import { useDraftNavigation } from "@/lib/use-draft-navigation";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";
import { useCallback,useEffect,useRef,useState,useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { recordId } from "@/lib/domain/contracts";
import { tutorView } from "@/lib/tutor/view";
import type { TutorView } from "@/lib/tutor/view";
import type { TutorOverview } from "@/lib/tutor/overview";
import type { TutorAction } from "@/lib/tutor/request";
import { clientReady,serverReady,subscribeToHydration } from "@/lib/client-ready";
import { librarianJson } from "../library/client-api";
import { uploadTutorPhoto,readTutorPhotoIntent,rememberTutorPhotoIntent,clearTutorPhotoIntent } from "./photo-upload";
import type { TutorPhotoIntent } from "./photo-upload";
import { TutorPanel } from "./tutor-panel";
import type { TutorPanelAction } from "./tutor-panel";

const draftConflictMessage:string="다른 화면에서 초안이 변경됐어요. 현재 입력은 이 화면에 보관했고 자동으로 덮어쓰지 않았어요. 내용을 검토해 수정하거나 답안을 제출한 뒤 이동해 주세요.";

export function TutorClient({initial,initialView}:Readonly<{initial:TutorOverview;initialView:TutorView|null}>):ReactElement {
  const [view,setView]=useState<TutorView|null>(initialView);const [text,setText]=useState<string>(initialView?.draft.text ?? "");const [fileIds,setFileIds]=useState<readonly string[]>(initialView?.draft.fileIds ?? []);const [busy,setBusy]=useState<boolean>(false);const [error,setError]=useState<string>("");const [scope,setScope]=useState<string>(initial.scopes[0]?.id ?? "");
  const answerId=useRef<string>(crypto.randomUUID());const revisionId=useRef<string>(crypto.randomUUID());
  const [photoProgress,setPhotoProgress]=useState<string>("");
  const [covered,setCovered]=useState<boolean>(false);
  const photoIntent=useRef<TutorPhotoIntent|null>(null);
  const editedDraft=useRef<string|null>(null);
  const conflictedDraft=useRef<string|null>(null);
  const hydrated=useSyncExternalStore(subscribeToHydration,clientReady,serverReady);const inFlight=useRef<boolean>(false);const current=useRef<TutorView|null>(initialView);const pending=useRef<Readonly<{body:string;key:string}>|null>(null);const failedDraft=useRef<string|null>(null);const startIds=useRef({id:crypto.randomUUID(),questionId:crypto.randomUUID(),attemptId:crypto.randomUUID()});
  const accept=useCallback((next:TutorView):void=>{if(current.current && current.current.id===next.id && current.current.version>next.version) return;current.current=next;setView(next);},[]);
  const send=useCallback(async function send(input:TutorAction):Promise<boolean> {
    if(inFlight.current) return false;inFlight.current=true;setBusy(true);setError("");const body=JSON.stringify(input);const key=pending.current?.body===body ? pending.current.key : crypto.randomUUID();pending.current={body,key};
    try {accept(tutorView.parse(await librarianJson("/api/tutor",{method:"POST",headers:{"content-type":"application/json","idempotency-key":key},body})));pending.current=null;return true;}
    catch(cause:unknown){if(!(cause instanceof Error)) throw cause;setError(cause.message);return false;}finally{inFlight.current=false;setBusy(false);}
  },[accept]);
  const draftKey=JSON.stringify({text,fileIds});const saved:boolean=view!==null && draftKey===JSON.stringify(view.draft);
  const saveBeforeLeave=useCallback(async():Promise<boolean>=>{if(conflictedDraft.current===JSON.stringify({text,fileIds})){setError(draftConflictMessage);return false;}const latest=current.current;if(!latest || latest.phase!=="awaiting-answer" || editedDraft.current===null || JSON.stringify(latest.draft)===JSON.stringify({text,fileIds})) return true;const ok=await send({action:"draft",id:latest.id,expectedVersion:latest.version,draft:{text,fileIds:fileIds.map(id=>recordId.parse(id))}});if(!ok) failedDraft.current=JSON.stringify({text,fileIds});else if(editedDraft.current===JSON.stringify({text,fileIds})) editedDraft.current=null;return ok;},[text,fileIds,send]);
  useDraftNavigation({dirty:view?.phase==="awaiting-answer" && !saved,busy,save:saveBeforeLeave,onError:setError});
  useEffect(()=>{
    if(!hydrated || !view || view.phase!=="awaiting-answer" || covered || busy || saved || editedDraft.current!==draftKey || failedDraft.current===draftKey || conflictedDraft.current===draftKey) return;
    const timer=setTimeout(()=>{void send({action:"draft",id:view.id,expectedVersion:view.version,draft:{text,fileIds:fileIds.map((id)=>recordId.parse(id))}}).then((ok):void=>{if(!ok) failedDraft.current=draftKey;else if(editedDraft.current===draftKey) editedDraft.current=null;});},800);
    return ():void=>clearTimeout(timer);
  },[hydrated,view,covered,busy,saved,draftKey,text,fileIds,send]);
  const refresh=useCallback(async (id:string):Promise<void>=>{
    if(inFlight.current) return;setBusy(true);setError("");inFlight.current=true;
    const previous=current.current;const localKey=JSON.stringify({text,fileIds});
    const dirty=editedDraft.current===localKey && previous!==null && JSON.stringify(previous.draft)!==localKey;
    try {
      const next=tutorView.parse(await librarianJson(`/api/tutor?id=${encodeURIComponent(id)}`,{method:"GET"}));
      if(previous?.id===id && next.version<previous.version) throw new Error("서버에서 이전 수업 버전을 반환했어요. 현재 입력을 유지했으니 잠시 후 다시 확인해 주세요.");
      if(previous?.id!==id || !dirty){setText(next.draft.text);setFileIds(next.draft.fileIds);editedDraft.current=null;failedDraft.current=null;conflictedDraft.current=null;}
      else if(conflictedDraft.current===localKey || next.version!==previous.version && JSON.stringify(next.draft)!==JSON.stringify(previous.draft)){
        conflictedDraft.current=localKey;failedDraft.current=localKey;setError(draftConflictMessage);
      }else failedDraft.current=null;
      accept(next);setCovered(false);
    }catch(cause:unknown){if(!(cause instanceof Error)) throw cause;setError(cause.message);}finally{inFlight.current=false;setBusy(false);}
  },[accept,text,fileIds]);
  useEffect(()=>{
    function conceal():void {setCovered(true);}
    function restore():void {const active=current.current;if(active) void refresh(active.id);else setCovered(false);}
    function visibility():void {if(document.visibilityState==="hidden") conceal();else restore();}
    window.addEventListener(RECALL_START_EVENT,conceal);window.addEventListener("pagehide",conceal);window.addEventListener("pageshow",restore);document.addEventListener("visibilitychange",visibility);
    return ():void=>{window.removeEventListener(RECALL_START_EVENT,conceal);window.removeEventListener("pagehide",conceal);window.removeEventListener("pageshow",restore);document.removeEventListener("visibilitychange",visibility);};
  },[refresh]);
  async function start():Promise<void> {const ids=startIds.current;if(await send({action:"start",id:recordId.parse(ids.id),questionId:recordId.parse(ids.questionId),attemptId:recordId.parse(ids.attemptId),scopeId:recordId.parse(scope)})){setText("");setFileIds([]);editedDraft.current=null;conflictedDraft.current=null;startIds.current={id:crypto.randomUUID(),questionId:crypto.randomUUID(),attemptId:crypto.randomUUID()};}}
  async function act(action:TutorPanelAction):Promise<void> {
    let latest=current.current;if(!latest) return;
    if(action==="pause" && conflictedDraft.current===draftKey){setError(draftConflictMessage);return;}
    if(action==="pause" && latest.phase==="awaiting-answer" && JSON.stringify(latest.draft)!==JSON.stringify({text,fileIds})) {
      if(!await send({action:"draft",id:latest.id,expectedVersion:latest.version,draft:{text,fileIds:fileIds.map((id)=>recordId.parse(id))}})) return;
      latest=current.current;if(!latest) return;
    }
    if(action==="lesson" || action==="diagnose" || action==="recover" || action==="help" || action==="variation") {if(await send({action,id:latest.id,expectedVersion:latest.version}) && (action==="help" || action==="variation")){setText("");setFileIds([]);editedDraft.current=null;conflictedDraft.current=null;}return;}
    if(action==="revise") {if(await send({action,id:latest.id,expectedVersion:latest.version,attemptId:recordId.parse(revisionId.current)})) revisionId.current=crypto.randomUUID();return;}
    if(action==="recall" || action==="direct" || action==="pause" || action==="resume" || action==="finish") await send({action,id:latest.id,expectedVersion:latest.version});
  }
  async function submit():Promise<void> {const latest=current.current;if(!latest) return;if(await send({action:"submit",id:latest.id,expectedVersion:latest.version,answerId:recordId.parse(answerId.current),draft:{text,fileIds:fileIds.map((id)=>recordId.parse(id))}})) {answerId.current=crypto.randomUUID();editedDraft.current=null;conflictedDraft.current=null;}}
  async function upload(file:File):Promise<void> {
    const latest=current.current;if(!latest || inFlight.current) return;if(conflictedDraft.current===draftKey){setError(draftConflictMessage);return;}inFlight.current=true;setBusy(true);setError("");
    try {const id=await uploadTutorPhoto(file,latest.courseId,photoIntent.current ?? readTutorPhotoIntent(latest.id),(intent):void=>{rememberTutorPhotoIntent(latest.id,intent);photoIntent.current=intent;},setPhotoProgress);setPhotoProgress("등록한 사진을 답안 초안에 저장하고 있어요.");const ids=fileIds.includes(id) ? fileIds : [...fileIds,id];setFileIds(ids);editedDraft.current=JSON.stringify({text,fileIds:ids});failedDraft.current=null;inFlight.current=false;
      if(await send({action:"draft",id:latest.id,expectedVersion:latest.version,draft:{text,fileIds:ids.map((item)=>recordId.parse(item))}})){clearTutorPhotoIntent(latest.id);photoIntent.current=null;editedDraft.current=null;setPhotoProgress("사진 첨부와 초안 저장이 완료됐어요.");}else{failedDraft.current=JSON.stringify({text,fileIds:ids});setPhotoProgress("사진은 등록됐지만 답안 저장이 확인되지 않았어요. 같은 사진을 다시 선택해 이어서 저장해 주세요.");}}
    catch(cause:unknown){if(!(cause instanceof Error)) throw cause;setPhotoProgress("사진 첨부가 완료되지 않았어요. 같은 사진을 다시 선택해 저장 결과를 확인해 주세요.");setError(cause.message);}finally{inFlight.current=false;setBusy(false);}
  }
  return <div inert={!hydrated}><nav className="learning-flow-nav" aria-label="학습 화면 이동"><a href="/learn">오늘의 학습 현황</a>{view?.phase==="finished" && <a href="/learn/tutor#reviews">복습 일정 확인</a>}</nav>{photoProgress && <p role="status" aria-label="사진 전송 상태">{photoProgress}</p>}{(!view || view.phase==="finished") && <section><h2>확정한 범위로 시작</h2>{initial.scopes.length===0 ? <p><a href="/learn/library">오늘의 학습 범위를 먼저 확정해 주세요.</a></p> : <><label>학습 범위<select value={scope} disabled={busy} onChange={(event):void=>setScope(event.target.value)}>{initial.scopes.map((item)=><option key={item.id} value={item.id}>{item.date} · {item.title}</option>)}</select></label><button disabled={busy || !scope} onClick={():void=>{void start();}}>수업 시작</button></>}</section>}{initial.history.length>0 && <label>수업 기록<select value={view?.id ?? ""} disabled={busy} onChange={(event):void=>{const id=event.target.value;void saveBeforeLeave().then(ok=>{if(ok) void refresh(id);});}}>{initial.history.map((item)=><option key={item.id} value={item.id}>{item.title} · 기록 {item.version}판</option>)}</select></label>}{view ? <><button disabled={busy} onClick={():void=>{void refresh(view.id);}}>최신 수업 기록 확인</button>{covered ? <><p>최신 수업 상태를 확인하고 있어요. 확인에 실패하면 위 버튼을 눌러 주세요.</p>{error && <p role="alert">{error}</p>}</> : <TutorPanel view={view} text={text} busy={busy} saved={saved} error={error} onText={(value):void=>{editedDraft.current=JSON.stringify({text:value,fileIds});setText(value);failedDraft.current=null;conflictedDraft.current=null;}} onSubmit={():void=>{void submit();}} onAction={(action):void=>{void act(action);}} fileNames={fileIds.map((_id,index):string=>`풀이 사진 ${index+1}`)} onFile={(file):void=>{void upload(file);}}/>}</> : error && <p role="alert">{error}</p>}</div>;
}
