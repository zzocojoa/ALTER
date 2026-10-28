"use client";
import { EditorNewAiAction } from "./ai-actions";
import { TutorPendingAi } from "../tutor/ai-actions";
import type { ActionAvailability } from "@/components/alter/action-button";
import { EditorHistory } from "./editor-history";
import type { SaveState } from "@/lib/ui/save-status";
import { SaveStatus } from "@/components/alter/status";
import { ActionButton } from "@/components/alter/action-button";
import { ServiceFailureHelp } from "../service-availability";
import { EditorInput } from "./editor-input";
import { EditorFeedback } from "./editor-feedback";
import type { ReactElement } from "react";
import type { EditorView } from "@/lib/editor/view";
export type EditorPanelAction="feedback"|"review"|"recover"|"cancel"|"variation"|"finish";
export type EditorPanelProps=Readonly<{aiUnavailable:string|null;view:EditorView;text:string;reason:string;fileNames:readonly string[];busy:boolean;inputBusy:boolean;uncertain:boolean;saveState:SaveState;submitting:boolean;retryAvailable:boolean;onRetry:()=>void;historyOpen:boolean;onHistoryOpen:(opened:boolean)=>void;feedbackOpen:boolean;onFeedbackOpen:(opened:boolean)=>void;composing:boolean;saved:boolean;error:string;onText:(value:string)=>void;onReason:(value:string)=>void;onComposition:(active:boolean)=>void;onSubmit:()=>void;onAction:(action:EditorPanelAction)=>void;onFile:(file:File)=>void}>;

export function EditorPanel({aiUnavailable,view,text,reason,fileNames,busy,inputBusy,uncertain,saveState,submitting,retryAvailable,onRetry,historyOpen,onHistoryOpen,feedbackOpen,onFeedbackOpen,composing,saved,error,onText,onReason,onComposition,onSubmit,onAction,onFile}:EditorPanelProps):ReactElement {
  const aiAvailability:ActionAvailability=aiUnavailable ? {kind:"blocked",reason:aiUnavailable} : uncertain ? {kind:"blocked",reason:"앞선 요청의 저장 결과를 먼저 확인해 주세요."} : busy || composing ? {kind:"busy",reason:"현재 입력·저장 요청을 마친 뒤 확인해 주세요."} : view.tutor.pending ? {kind:"blocked",reason:"기존 AI 요청 결과를 먼저 확인해 주세요."} : !view.tutor.current ? {kind:"blocked",reason:"학습 범위와 원문을 다시 확인해 주세요."} : {kind:"available"};
  const waiting=view.tutor.phase!=="finished" && (view.phase==="draft" || view.phase==="awaiting-revision");
  return <section className="tutor-panel editor-panel" aria-label="결과물 개선" data-learning-focus={view.tutor.phase !== "finished" && view.tutor.phase !== "paused"}><h2>{view.tutor.title}</h2><p>기록 {view.tutor.version}판 · 수정본 평가와 독립 수행은 별도로 확인해요.</p>{view.tutor.issue && <p role="alert">{view.tutor.issue}</p>}{error && <p id="editor-input-error" role="alert">{error} 입력 내용은 지우지 않았어요.</p>}{error && <ServiceFailureHelp/>}{!waiting && <SaveStatus id="editor-record-status" state={saveState}/>} {retryAvailable && <ActionButton id="editor-retry-save" type="button" tone="secondary" availability={busy ? {kind:"busy",reason:"같은 저장 요청의 결과를 확인하고 있어요."} : {kind:"available"}} onClick={onRetry}>같은 저장 요청 다시 확인</ActionButton>}<h3>{view.phase==="variation" ? "원본 초안과 피드백" : view.tutor.question.prompt}</h3>

    {view.tutor.phase==="finished" && view.phase!=="variation" && <p role="status">초안과 피드백을 보관하고 종료한 기록이에요. 개선 완료나 독립 수행으로 확정하지 않았어요.</p>}<div className="editor-revision-layout" data-editing={waiting}>{waiting && view.feedbacks.length > 0 && <a className="editor-input-jump" href="#editor-text">수정본·이유 쓰기로 이동 ↓</a>}<EditorFeedback view={view} opened={feedbackOpen} onOpened={onFeedbackOpen}/>{waiting && <EditorInput view={view} text={text} reason={reason} fileNames={fileNames} busy={busy} inputBusy={inputBusy} uncertain={uncertain} saveState={saveState} submitting={submitting} composing={composing} saved={saved} error={error} onText={onText} onReason={onReason} onComposition={onComposition} onSubmit={onSubmit} onFile={onFile}/>}</div>
    {view.tutor.phase!=="finished" && view.phase==="draft-saved" && <EditorNewAiAction key={`${view.tutor.id}:${view.tutor.version}:feedback`} view={view} action="feedback" availability={aiAvailability} onRequest={():void=>onAction("feedback")}/>}
    {view.tutor.phase!=="finished" && view.phase==="revision-saved" && <><EditorNewAiAction key={`${view.tutor.id}:${view.tutor.version}:review`} view={view} action="review" availability={aiAvailability} onRequest={():void=>onAction("review")}/><p>수정본과 이유를 저장했어요. 원본과 피드백은 그대로 보관해요.</p></>}
    {view.transfer && <article><h3>새 조건의 실제 답안</h3><p>{view.transfer.question}</p><p>{view.transfer.answer}</p><p>사진 {view.transfer.photoCount}개 · {view.transfer.helped ? "이 문제 도움 사용" : "이 문제 도움 사용 없음"}</p>{view.transfer.observation && <p>{view.transfer.observation}</p>}<p>{view.transfer.candidate ? "새 조건의 무도움 수행 근거 후보예요. 수행 수준 확정은 별도 평가에서 확인해요." : "아직 새 조건의 무도움 성공 근거로 인정되지 않았어요."}</p></article>}
    {view.reviews.map((review)=><article key={review.id}><h3>수정본 재평가 · 독립 수행과 별도</h3>{review.needsRecheck && <p role="alert">이 평가는 연결 근거가 바뀌어 재검토가 필요해요.</p>}<p>{review.outcome==="ready-for-recheck" ? "지적했던 문제의 개선을 확인했어요. 이 평가는 수정본에 대한 결과예요." : "아직 수정할 부분이 남았어요. 피드백을 확인하고 직접 고친 내용과 이유를 적어 주세요."}</p>{review.checks.map((check)=><section key={check.itemId}><p>{check.resolved ? "이 지적은 개선됨" : "이 지적은 추가 수정 필요"}</p>{check.revisionLocation.kind==="text" && <blockquote>{check.revisionLocation.quote}<small>내 수정본의 근거</small></blockquote>}<p>내가 적은 이유: {check.reasonQuote}</p></section>)}</article>)}
    {view.tutor.phase!=="finished" && view.phase==="ready-for-recheck" && <EditorNewAiAction key={`${view.tutor.id}:${view.tutor.version}:variation`} view={view} action="variation" availability={aiAvailability} onRequest={():void=>onAction("variation")}/>}
    {view.tutor.phase==="answer-saved" && !view.tutor.pending && <button disabled={busy || composing || uncertain || !saved} onClick={():void=>onAction("finish")}>첨삭 기록 보관하고 종료 · 수행 미확정</button>}
    {view.tutor.pending && <><TutorPendingAi pending={view.tutor.pending} availability={busy || composing || uncertain ? {kind:"blocked",reason:"현재 입력·저장 요청을 마친 뒤 확인해 주세요."} : {kind:"available"}} onRecover={():void=>onAction("recover")}/>{["editor-draft-feedback","editor-revision-review"].includes(view.tutor.pending.kind) && <div className="editor-close-pending"><button disabled={busy || composing || uncertain} onClick={():void=>onAction("cancel")}>결과 확인을 닫고 입력 보관</button><p className="alter-caption">전송 취소나 비용 환불이 아니에요. 이미 보낸 요청의 비용·실패 이력과 초안은 남아요.</p></div>}</>}

    <EditorHistory view={view} opened={historyOpen} onOpened={onHistoryOpen} onFeedback={():void=>onFeedbackOpen(true)}/>

  </section>;
}
