"use client";
import { matchesAiStartRejection } from "@/lib/tutor/ai-start-rejection";
import { useReviewAnswerFocus } from "./review-answer-focus";
import { rememberTutorAiIntent, readTutorAiIntent, clearTutorAiIntent } from "./ai-intent";
import { tutorAiIntent, tutorAiObservationReply } from "@/lib/tutor/ai-observation";
import type { TutorAiIntent } from "@/lib/tutor/ai-observation";
import { ActionButton } from "@/components/alter/action-button";
import { useDraftNavigation } from "@/lib/use-draft-navigation";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";
import { useCallback,useEffect,useRef,useState,useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { observedTutorWrite, tutorSaveState, tutorWriteFailure, requireTutorResponse } from "./request-state";
import type { PendingTutorRequest, TutorWriteFailure } from "./request-state";
import { canonicalJson, recordId } from "@/lib/domain/contracts";
import { tutorView } from "@/lib/tutor/view";
import type { TutorView } from "@/lib/tutor/view";
import type { TutorOverview } from "@/lib/tutor/overview";
import { tutorAiAction, type TutorAction } from "@/lib/tutor/request";
import { clientReady,serverReady,subscribeToHydration } from "@/lib/client-ready";
import { librarianJson, LibrarianRequestError } from "../library/client-api";
import { uploadTutorPhoto,readTutorPhotoIntent,rememberTutorPhotoIntent,clearTutorPhotoIntent } from "./photo-upload";
import type { TutorPhotoIntent } from "./photo-upload";
import { tutorDraftInputIssue, tutorSubmissionIssue } from "./answer-fields";
import { TutorPanel } from "./tutor-panel";
import type { TutorPanelAction } from "./tutor-panel";

const draftConflictMessage:string="다른 화면에서 초안이 변경됐어요. 현재 입력은 이 화면에 보관했고 자동으로 덮어쓰지 않았어요. 내용을 검토해 수정하거나 답안을 제출한 뒤 이동해 주세요.";

export function TutorClient({initial,initialView}:Readonly<{initial:TutorOverview;initialView:TutorView|null}>):ReactElement {
  const [view,setView]=useState<TutorView|null>(initialView);const [text,setText]=useState<string>(initialView?.draft.text ?? "");const [fileIds,setFileIds]=useState<readonly string[]>(initialView?.draft.fileIds ?? []);const [busy,setBusy]=useState<boolean>(false);const [error,setError]=useState<string>("");const [scope,setScope]=useState<string>(initial.scopes[0]?.id ?? "");
  const answerId=useRef<string>(crypto.randomUUID());const revisionId=useRef<string>(crypto.randomUUID());
  const [requestAction,setRequestAction]=useState<TutorAction["action"]|null>(null);
  const [writeFailure,setWriteFailure]=useState<TutorWriteFailure|null>(null);
  const uncertain=useRef<boolean>(false);
  const aiIntent=useRef<TutorAiIntent|null>(null);
  const [unresolvedAi,setUnresolvedAi]=useState<TutorAiIntent|null>(null);
  const [intentReady,setIntentReady]=useState<boolean>(false);
  const [intentIssue,setIntentIssue]=useState<string|null>(null);
  const [aiRefreshRequired,setAiRefreshRequired]=useState<boolean>(false);
  const [unresolvedRequest,setUnresolvedRequest]=useState<PendingTutorRequest|null>(null);
  const [composing,setComposing]=useState<boolean>(false);
  const [photoProgress,setPhotoProgress]=useState<string>("");
  const [covered,setCovered]=useState<boolean>(false);
  const concealEpoch=useRef<number>(0);
  const restoreWanted=useRef<boolean>(false);
  const [restoreRequest,setRestoreRequest]=useState<number>(0);
  const photoIntent=useRef<TutorPhotoIntent|null>(null);
  const pendingPhotoId=useRef<string|null>(null);
  const editedDraft=useRef<string|null>(null);
  const conflictedDraft=useRef<string|null>(null);
  const hydrated=useSyncExternalStore(subscribeToHydration,clientReady,serverReady);const inFlight=useRef<boolean>(false);const current=useRef<TutorView|null>(initialView);const pending=useRef<PendingTutorRequest|null>(null);const failedDraft=useRef<string|null>(null);const startIds=useRef({id:crypto.randomUUID(),questionId:crypto.randomUUID(),attemptId:crypto.randomUUID()});
  useEffect(()=>{const timer=setTimeout(()=>{try{const intent=initialView ? readTutorAiIntent(initialView.id) : null;aiIntent.current=intent;if(intent){pending.current={input:intent.input,body:canonicalJson(intent.input),key:intent.key};if(intent.input.action!=="recover") setUnresolvedAi(intent);}setIntentReady(true);}catch(cause:unknown){if(!(cause instanceof Error)) throw cause;setIntentIssue("보관 요청 식별자를 읽지 못했어요. 브라우저 저장소 상태를 확인한 뒤 새로고침해 주세요. 새 AI 요청은 잠갔어요.");setError(cause.message);setIntentReady(true);}},0);return ():void=>clearTimeout(timer);},[initialView]);
  const accept=useCallback((next:TutorView):void=>{current.current=next;setView(next);},[]);
  const send=useCallback(async function send(input:TutorAction):Promise<boolean> {
    if(tutorAiAction.safeParse(input).success && intentIssue){setError(intentIssue);return false;}if(inFlight.current || !intentReady || aiRefreshRequired || aiIntent.current && aiIntent.current.input.action!=="recover") return false;const serialized=canonicalJson(input);if(uncertain.current && pending.current?.body!==serialized){setError("앞선 저장 결과를 먼저 확인해 주세요. 같은 요청 확인 또는 최신 수업 기록 확인을 이용해 주세요.");return false;}inFlight.current=true;setRequestAction(input.action);setWriteFailure(null);setBusy(true);setError("");const body=canonicalJson(input);const key=pending.current?.body===body ? pending.current.key : crypto.randomUUID();pending.current={body,key,input};
    try {const ai=tutorAiIntent.safeParse({key,input});if(ai.success){rememberTutorAiIntent(ai.data);aiIntent.current=ai.data;}
      const next=tutorView.parse(await librarianJson("/api/tutor",{method:"POST",headers:{"content-type":"application/json","idempotency-key":key},body}));requireTutorResponse(input.id,current.current,next);accept(next);if(ai.success){clearTutorAiIntent(input.id);aiIntent.current=null;setUnresolvedAi(null);}pending.current=null;uncertain.current=false;setUnresolvedRequest(null);setWriteFailure(null);return true;}
    catch(cause:unknown){if(!(cause instanceof Error)) throw cause;if(cause instanceof LibrarianRequestError && [401,403].includes(cause.status)) setCovered(true);if(aiIntent.current && cause instanceof LibrarianRequestError && matchesAiStartRejection(cause.aiStartRejection,aiIntent.current)){clearTutorAiIntent(input.id);aiIntent.current=null;pending.current=null;setUnresolvedAi(null);setAiRefreshRequired(true);}else if(aiIntent.current && aiIntent.current.input.action!=="recover") setUnresolvedAi(aiIntent.current);const failure=tutorWriteFailure(cause);uncertain.current=failure.kind==="unknown" && ["draft","submit"].includes(input.action);setUnresolvedRequest(uncertain.current ? pending.current : null);setWriteFailure(failure);setError(cause.message);return false;}finally{inFlight.current=false;setBusy(false);setRequestAction(null);}
  },[accept,intentReady,intentIssue,aiRefreshRequired]);
  const draftKey=JSON.stringify({text,fileIds});const saved:boolean=view!==null && draftKey===JSON.stringify(view.draft);
  const saveBeforeLeave=useCallback(async():Promise<boolean>=>{if(composing || uncertain.current) return false;const issue=current.current ? tutorDraftInputIssue(current.current,text) : null;if(issue){setError(issue);return false;}if(conflictedDraft.current===JSON.stringify({text,fileIds})){setError(draftConflictMessage);return false;}const latest=current.current;if(!latest || latest.phase!=="awaiting-answer" || editedDraft.current===null || JSON.stringify(latest.draft)===JSON.stringify({text,fileIds})) return true;const ok=await send({action:"draft",id:latest.id,expectedVersion:latest.version,draft:{text,fileIds:fileIds.map(id=>recordId.parse(id))}});if(!ok) failedDraft.current=JSON.stringify({text,fileIds});else if(editedDraft.current===JSON.stringify({text,fileIds})) editedDraft.current=null;return ok;},[text,fileIds,send,composing]);
  useDraftNavigation({dirty:view?.phase==="awaiting-answer" && !saved,busy:busy || composing || unresolvedRequest!==null || unresolvedAi!==null,save:saveBeforeLeave,onError:setError});
  useEffect(()=>{
    if(!hydrated || !view || uncertain.current || composing || tutorDraftInputIssue(view,text) || view.phase!=="awaiting-answer" || covered || busy || saved || editedDraft.current!==draftKey || failedDraft.current===draftKey || conflictedDraft.current===draftKey) return;
    const timer=setTimeout(()=>{void send({action:"draft",id:view.id,expectedVersion:view.version,draft:{text,fileIds:fileIds.map((id)=>recordId.parse(id))}}).then((ok):void=>{if(!ok) failedDraft.current=draftKey;else if(editedDraft.current===draftKey) editedDraft.current=null;});},800);
    return ():void=>clearTimeout(timer);
  },[hydrated,view,covered,busy,saved,draftKey,text,fileIds,send,composing]);
  const refresh=useCallback(async (id:string):Promise<void>=>{
    if(inFlight.current || composing) return;setBusy(true);setError("");inFlight.current=true;
    restoreWanted.current=false;const epoch=concealEpoch.current;const previous=current.current;const localKey=JSON.stringify({text,fileIds});
    const dirty=editedDraft.current===localKey && previous!==null && JSON.stringify(previous.draft)!==localKey;
    try {
      const intent=aiIntent.current?.input.action!=="recover" ? aiIntent.current : null;
      const raw=await librarianJson(`/api/tutor?id=${encodeURIComponent(id)}${intent ? `&aiIntent=${encodeURIComponent(JSON.stringify(intent))}` : ""}`,{method:"GET"});
      const observed=intent ? tutorAiObservationReply.parse(raw) : null;
      const next=observed ? observed.view : tutorView.parse(raw);
      if(observed && observed.observation.key!==intent?.key) throw new Error("다른 AI 요청의 조회 결과가 반환됐어요. 잠금을 유지했어요.");
      requireTutorResponse(id,previous,next);if(epoch!==concealEpoch.current) throw new Error("화면 전환 뒤 도착한 이전 조회는 적용하지 않았어요. 최신 수업 상태를 다시 확인해 주세요.");
      if(observed && intent){const observation=observed.observation;const matched=observation.status==="pending" && observation.logicalKey===next.pending?.key || observation.status==="completed" && observation.version!==null && next.version>=observation.version;
        if(matched){clearTutorAiIntent(id);aiIntent.current=null;pending.current=null;setUnresolvedAi(null);}else setError("기존 AI 요청의 저장 결과가 아직 확인되지 않았어요. 새 요청을 보내지 않고 같은 식별자로 조회를 계속할 수 있어요.");}
      const acknowledged=uncertain.current && pending.current!==null && observedTutorWrite(pending.current.input,next);
      if(previous?.id!==id || !dirty){setText(next.draft.text);setFileIds(next.draft.fileIds);editedDraft.current=null;failedDraft.current=null;conflictedDraft.current=null;}
      else if(!acknowledged && (conflictedDraft.current===localKey || next.version!==previous.version && JSON.stringify(next.draft)!==JSON.stringify(previous.draft))){
        conflictedDraft.current=localKey;failedDraft.current=localKey;setError(draftConflictMessage);setWriteFailure({kind:"conflict",detail:draftConflictMessage});
      }else failedDraft.current=null;
      if(acknowledged){uncertain.current=false;pending.current=null;setUnresolvedRequest(null);setWriteFailure(null);if(localKey===JSON.stringify(next.draft)) editedDraft.current=null;failedDraft.current=null;conflictedDraft.current=null;if(pendingPhotoId.current && next.draft.fileIds.some((fileId):boolean=>fileId===pendingPhotoId.current)){clearTutorPhotoIntent(id);photoIntent.current=null;pendingPhotoId.current=null;setPhotoProgress("사진 첨부와 초안 저장이 완료됐어요.");}}
      else if(!uncertain.current && conflictedDraft.current!==localKey) setWriteFailure(null);
      accept(next);setAiRefreshRequired(false);setCovered(false);
    }catch(cause:unknown){if(!(cause instanceof Error)) throw cause;if(cause instanceof LibrarianRequestError && [401,403].includes(cause.status)) setCovered(true);setError(cause.message);}finally{inFlight.current=false;setBusy(false);}
  },[accept,text,fileIds,composing]);
  useEffect(()=>{
    function conceal():void {concealEpoch.current+=1;setComposing(false);setCovered(true);}
    function restore():void {if(current.current){restoreWanted.current=true;setCovered(true);setRestoreRequest((value):number=>value+1);}else setCovered(false);}
    function visibility():void {if(document.visibilityState==="hidden") conceal();else restore();}
    window.addEventListener(RECALL_START_EVENT,conceal);window.addEventListener("pagehide",conceal);window.addEventListener("pageshow",restore);document.addEventListener("visibilitychange",visibility);
    return ():void=>{window.removeEventListener(RECALL_START_EVENT,conceal);window.removeEventListener("pagehide",conceal);window.removeEventListener("pageshow",restore);document.removeEventListener("visibilitychange",visibility);};
  },[]);
  useEffect(()=>{
    if(!covered || busy || composing || !restoreWanted.current) return;
    const timer=setTimeout(()=>{const active=current.current;if(active) void refresh(active.id);},0);
    return ():void=>clearTimeout(timer);
  },[covered,busy,composing,refresh,restoreRequest]);
  async function start():Promise<void> {const ids=startIds.current;if(await send({action:"start",id:recordId.parse(ids.id),questionId:recordId.parse(ids.questionId),attemptId:recordId.parse(ids.attemptId),scopeId:recordId.parse(scope)})){const url=new URL(window.location.href);url.searchParams.set("id",ids.id);window.history.replaceState(window.history.state,"",url);setText("");setFileIds([]);editedDraft.current=null;conflictedDraft.current=null;startIds.current={id:crypto.randomUUID(),questionId:crypto.randomUUID(),attemptId:crypto.randomUUID()};}}
  async function act(action:TutorPanelAction):Promise<void> {
    let latest=current.current;if(!latest || composing || uncertain.current || unresolvedAi) return;
    if(["lesson","diagnose","help","variation"].includes(action) && (latest.id!==view?.id || latest.version!==view?.version)){setError("전송 내용의 기록이 바뀌었어요. 최신 내용을 확인하고 다시 동의해 주세요.");return;}
    if(action==="recover" && !latest.pending){setError("이 회차에 확인할 기존 AI 요청이 없어요. 새 요청으로 바꾸지 않았어요.");return;}
    if(["lesson","diagnose","help","variation"].includes(action) && latest.pending){setError("기존 AI 요청의 결과를 먼저 확인해 주세요. 새 요청을 보내지 않았어요.");return;}
    if(action==="pause"){const issue=tutorDraftInputIssue(latest,text);if(issue){setError(issue);return;}}
    if(action==="pause" && conflictedDraft.current===draftKey){setError(draftConflictMessage);return;}
    if(action==="pause" && latest.phase==="awaiting-answer" && JSON.stringify(latest.draft)!==JSON.stringify({text,fileIds})) {
      if(!await send({action:"draft",id:latest.id,expectedVersion:latest.version,draft:{text,fileIds:fileIds.map((id)=>recordId.parse(id))}})) return;
      latest=current.current;if(!latest) return;
    }
    if(action==="lesson" || action==="diagnose" || action==="recover" || action==="help" || action==="variation") {if(await send({action,id:latest.id,expectedVersion:latest.version}) && (action==="help" || action==="variation")){setText("");setFileIds([]);editedDraft.current=null;conflictedDraft.current=null;}return;}
    if(action==="revise") {if(await send({action,id:latest.id,expectedVersion:latest.version,attemptId:recordId.parse(revisionId.current)})) revisionId.current=crypto.randomUUID();return;}
    if(action==="recall" || action==="direct" || action==="pause" || action==="resume" || action==="finish") await send({action,id:latest.id,expectedVersion:latest.version});
  }
  async function submit():Promise<void> {const latest=current.current;if(!latest || composing || uncertain.current || unresolvedAi) return;const issue=tutorSubmissionIssue(latest,text,fileIds.length);if(issue){setError(issue);return;}if(await send({action:"submit",id:latest.id,expectedVersion:latest.version,answerId:recordId.parse(answerId.current),draft:{text,fileIds:fileIds.map((id)=>recordId.parse(id))}})) {answerId.current=crypto.randomUUID();editedDraft.current=null;conflictedDraft.current=null;}}
  async function upload(file:File):Promise<void> {
    const latest=current.current;if(!latest || inFlight.current || composing || uncertain.current) return;const inputIssue=tutorDraftInputIssue(latest,text);if(inputIssue){setError(inputIssue);return;}if(conflictedDraft.current===draftKey){setError(draftConflictMessage);return;}inFlight.current=true;setBusy(true);setError("");
    try {const id=await uploadTutorPhoto(file,latest.courseId,photoIntent.current ?? readTutorPhotoIntent(latest.id),(intent):void=>{rememberTutorPhotoIntent(latest.id,intent);photoIntent.current=intent;},setPhotoProgress);pendingPhotoId.current=id;setPhotoProgress("등록한 사진을 답안 초안에 저장하고 있어요.");const ids=fileIds.includes(id) ? fileIds : [...fileIds,id];setFileIds(ids);editedDraft.current=JSON.stringify({text,fileIds:ids});failedDraft.current=null;inFlight.current=false;
      if(await send({action:"draft",id:latest.id,expectedVersion:latest.version,draft:{text,fileIds:ids.map((item)=>recordId.parse(item))}})){clearTutorPhotoIntent(latest.id);photoIntent.current=null;pendingPhotoId.current=null;editedDraft.current=null;setPhotoProgress("사진 첨부와 초안 저장이 완료됐어요.");}else{failedDraft.current=JSON.stringify({text,fileIds:ids});setPhotoProgress("사진은 등록됐지만 답안 저장이 확인되지 않았어요. 아래 저장 상태에서 같은 요청을 확인해 주세요.");}}
    catch(cause:unknown){if(!(cause instanceof Error)) throw cause;setPhotoProgress("사진 첨부가 완료되지 않았어요. 같은 사진을 다시 선택해 저장 결과를 확인해 주세요.");setError(cause.message);}finally{inFlight.current=false;setBusy(false);}
  }
  async function retryWrite():Promise<void> {
    const request=pending.current;if(!request || !uncertain.current || !["draft","submit"].includes(request.input.action)) return;
    const input=request.input;
    if(await send(input)){failedDraft.current=null;if(input.action!=="draft" || editedDraft.current===JSON.stringify(input.draft)) editedDraft.current=null;conflictedDraft.current=null;if(input.action==="submit") answerId.current=crypto.randomUUID();
      if(input.action==="draft" && pendingPhotoId.current && input.draft.fileIds.some((id):boolean=>id===pendingPhotoId.current)){clearTutorPhotoIntent(input.id);photoIntent.current=null;pendingPhotoId.current=null;setPhotoProgress("사진 첨부와 초안 저장이 완료됐어요.");}}
  }
  useReviewAnswerFocus(view, hydrated && intentReady && !covered && !busy && unresolvedRequest===null && unresolvedAi===null);
  return <div className="tutor-workspace" inert={!hydrated || !intentReady}>
    {!intentReady && error && <p role="alert">{error}</p>}
    {unresolvedAi && !covered && <section className="tutor-ai-recovery" aria-label="AI 전송 결과 불명"><h3>AI 전송 결과를 아직 확인하지 못했어요</h3><p>실패나 무료 취소로 확정하지 않아요. 화면을 닫아도 이미 전송된 요청의 비용은 발생할 수 있어요. 새 생성은 잠갔고 같은 요청의 저장 상태만 조회해요.</p><p>요청 기준 기록 {unresolvedAi.input.expectedVersion}판 · 식별자 {unresolvedAi.key}</p><ActionButton id="tutor-ai-observe" type="button" tone="secondary" availability={busy ? {kind:"busy",reason:"같은 요청의 저장 상태를 읽고 있어요."} : {kind:"available"}} onClick={():void=>{void refresh(unresolvedAi.input.id);}}>같은 AI 요청 상태 확인</ActionButton></section>}
    {view && <>{covered ? <section className="tutor-access-check"><p>최신 수업 상태를 확인하고 있어요. 확인에 실패하면 아래 버튼을 눌러 주세요.</p>{error && <p role="alert">{error}</p>}</section> : <TutorPanel aiUnavailable={intentIssue} inputBusy={busy && requestAction!=="draft"} saveState={tutorSaveState({view,saved,text,fileCount:fileIds.length,action:requestAction,failure:writeFailure})} submitting={requestAction==="submit"} uncertain={unresolvedRequest!==null || unresolvedAi!==null || aiRefreshRequired} retryAvailable={unresolvedRequest!==null && ["draft","submit"].includes(unresolvedRequest.input.action)} onRetry={():void=>{void retryWrite();}} photoProgress={photoProgress} composing={composing} onComposition={setComposing} view={view} text={text} busy={busy} saved={saved} error={error} onText={(value):void=>{editedDraft.current=JSON.stringify({text:value,fileIds});setText(value);failedDraft.current=null;conflictedDraft.current=null;if(!uncertain.current) setWriteFailure(null);}} onSubmit={():void=>{void submit();}} onAction={(action):void=>{void act(action);}} fileNames={fileIds.map((_id,index):string=>`풀이 사진 ${index+1}`)} onFile={(file):void=>{void upload(file);}}/>}</>}
    {(!view || view.phase==="finished") && <section className="tutor-start"><h2>확정한 범위로 시작</h2>{initial.scopes.length===0 ? <p><a href="/learn/library">오늘의 학습 범위를 먼저 확정해 주세요.</a></p> : <><label>학습 범위<select className="alter-control" value={scope} disabled={busy || composing} onChange={(event):void=>setScope(event.target.value)}>{initial.scopes.map((item)=><option key={item.id} value={item.id}>{item.date} · {item.title}</option>)}</select></label><button className="alter-control alter-button" disabled={busy || composing || !scope} onClick={():void=>{void start();}}>수업 시작</button></>}</section>}
    {!view && error && <p role="alert">{error}</p>}
    <section className="tutor-record-controls" aria-label="수업 기록 선택과 다시 읽기">
      {view && <button className="alter-control alter-button" disabled={busy || composing} onClick={():void=>{void refresh(view.id);}}>최신 수업 기록 확인</button>}
      {!covered && (initial.history.length>0 || view!==null) && <label>수업 기록<select className="alter-control" value={view?.id ?? ""} disabled={busy || composing || unresolvedRequest!==null || unresolvedAi!==null} onChange={(event):void=>{const id=event.target.value;void saveBeforeLeave().then(ok=>{if(ok){const url=new URL(window.location.href);url.pathname="/learn/tutor";url.searchParams.set("id",id);url.hash="tutor-answer";window.location.assign(url.href);}});}}>{view && !initial.history.some((item)=>item.id===view.id) && <option value={view.id}>{view.title} · 기록 {view.version}판</option>}{initial.history.map((item)=><option key={item.id} value={item.id}>{item.title} · 기록 {item.id===view?.id ? view.version : item.version}판</option>)}</select></label>}
    </section>
    <nav className="learning-flow-nav" aria-label="학습 화면 이동"><a href="/learn">오늘의 학습 현황</a>{view?.phase==="finished" && <a href="/learn/tutor#reviews">복습 일정 확인</a>}</nav>
  </div>;
}
