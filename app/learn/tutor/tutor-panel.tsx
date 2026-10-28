"use client";
import { hasTutorDiagnosisConflict,TUTOR_DIAGNOSIS_CONFLICT_MESSAGE } from "@/lib/tutor/diagnosis";
import { ServiceFailureHelp } from "../service-availability";
import { ActionBar } from "@/components/alter/action-bar";
import { ActionButton } from "@/components/alter/action-button";
import type { SaveState } from "@/lib/ui/save-status";
import { TutorNewAiAction, TutorPendingAi } from "./ai-actions";
import type { ActionAvailability } from "@/components/alter/action-button";
import { TutorSaveNotice } from "./save-notice";
import { TutorPhotoField } from "./photo-field";
import { AnswerInput } from "./answer-input";
import { tutorSubmissionIssue } from "./answer-fields";
import { ReviewFields } from "./review-fields";
import type { ReactElement } from "react";
import { TutorHelpHistory, tutorHelpLabels } from "./help-history";
import { HelpDelivery } from "./help-delivery";
import type { TutorView } from "@/lib/tutor/view";

export type TutorPanelAction = "lesson" | "recall" | "direct" | "diagnose" | "revise" | "pause" | "resume" | "help" | "variation" | "finish" | "recover";
export type TutorPanelProps = Readonly<{aiUnavailable:string|null;view:TutorView;text:string;busy:boolean;saved:boolean;error:string;onText:(text:string)=>void;onSubmit:()=>void;onAction:(action:TutorPanelAction)=>void;onFile:(file:File)=>void;fileNames:readonly string[];composing:boolean;photoProgress:string;inputBusy:boolean;saveState:SaveState;submitting:boolean;uncertain:boolean;retryAvailable:boolean;onRetry:()=>void;onComposition:(active:boolean)=>void}>;
export function TutorPanel({aiUnavailable,view,text,busy,saved,error,onText,onSubmit,onAction,onFile,fileNames,composing,onComposition,photoProgress,inputBusy,saveState,submitting,uncertain,retryAvailable,onRetry}:TutorPanelProps):ReactElement {
  const conflict:boolean=hasTutorDiagnosisConflict(view.diagnosis);
  const submissionIssue:string|null=tutorSubmissionIssue(view,text,fileNames.length);
  const waiting:boolean=view.phase==="awaiting-answer";
  const aiAvailability:ActionAvailability=aiUnavailable ? {kind:"blocked",reason:aiUnavailable} : uncertain ? {kind:"blocked",reason:"앞선 요청의 저장 결과를 먼저 확인해 주세요."} : busy ? {kind:"busy",reason:"현재 요청 결과를 기다려 주세요."} : view.pending ? {kind:"blocked",reason:"기존 AI 요청 결과를 먼저 확인해 주세요."} : !view.current ? {kind:"blocked",reason:"학습 범위와 원문을 다시 확인해 주세요."} : {kind:"available"};
  return <section className="tutor-panel" aria-label="현재 수업" data-learning-focus={!["explanation", "paused", "finished"].includes(view.phase)}><header><h2>{view.title}</h2><p>기록 {view.version}판 · 오늘 복습 {view.dueCount}개</p></header>
    {view.issue && <p role="alert">{view.issue}</p>}{view.startIssues.map((issue)=><p key={issue}>{issue==="missing-next-action" ? "이전 회차의 다음 행동은 아직 확인되지 않았어요." : issue==="correction-recheck" ? "정정된 내용은 새 수행으로 재확인해야 해요." : "복습 일정의 근거 버전은 재확인이 필요해요."}</p>)}
    {error && <p id="tutor-input-error" role="alert">{error} 입력한 답안은 지우지 않았어요.</p>}{error && <ServiceFailureHelp/>}
    {!waiting && <TutorSaveNotice state={saveState} submitting={submitting} pendingAi={view.pending!==null}/>}
    {view.phase==="paused" ? <><p>수업을 잠시 멈췄어요. 같은 질문에서 이어갈 수 있어요.</p><button disabled={busy || composing || uncertain} onClick={():void=>onAction("resume")}>수업 이어가기</button></> : <>
      {view.nextAction && <p>이전 회차의 다음 행동: {view.nextAction}</p>}
      {view.phase==="explanation" && <>{view.sources.map((source)=><blockquote key={source.id}><p>{source.evidence}</p><cite>확인한 교재 · 파일 {source.filePage}페이지{source.printedPage ? ` · 인쇄 ${source.printedPage}쪽` : ""}</cite><a href={`/learn/source/${source.id}`}>이 교재 원본 위치 보기</a></blockquote>)}{view.lesson ? <><h3>AI 추가 설명</h3><p>{view.lesson.text}</p><button disabled={busy || composing || uncertain} onClick={():void=>onAction("recall")}>자료와 설명 가리고 시작</button></> : <TutorNewAiAction key={`${view.id}:${view.version}:lesson`} view={view} action="lesson" availability={aiAvailability} onRequest={():void=>onAction("lesson")}/>}<button disabled={busy || composing || uncertain} onClick={():void=>onAction("direct")}>설명 없이 직접 답안 쓰기</button></>}
      {view.phase==="finished" && <><p>수업 기록을 보관했어요. 답안·도움 사용 이력은 유지돼요.</p><a href={`/learn/results?id=${view.id}`}>이 수업 결과 확인·확정</a></>}
      {view.phase!=="explanation" && view.phase!=="finished" && <section className="tutor-current-prompt" aria-label="현재 질문"><p className="tutor-privacy">자료와 이전 AI 설명을 가렸어요. 지금 질문 하나에 자기 말로 답해 주세요.</p><h3 data-testid="tutor-question">{view.help?.learnerPrompt ?? view.question.prompt}</h3></section>}
      {waiting && <form className="tutor-answer-form" id="tutor-answer-area" tabIndex={-1} onSubmit={(event):void=>{event.preventDefault();if(!composing && !uncertain && !submissionIssue) onSubmit();}}>{view.review && view.question.mode!=="new-condition" ? <ReviewFields type={view.review.task.type} text={text} busy={inputBusy || uncertain} onText={onText} onComposition={onComposition}/> : <AnswerInput id="tutor-answer" label="나의 답안" value={text} limit={60000} required={false} describedBy={error ? "tutor-draft-status tutor-input-error tutor-answer-guidance" : "tutor-draft-status tutor-answer-guidance"} busy={inputBusy || uncertain} onValue={onText} onComposition={onComposition}/>}<TutorPhotoField busy={busy || uncertain} composing={composing} saved={saved} fileNames={fileNames} progress={photoProgress} onFile={onFile}/><TutorSaveNotice state={saveState} submitting={submitting} pendingAi={view.pending!==null}/><p id="tutor-answer-guidance" className="tutor-field-hint">{composing ? "한글 조합을 마친 뒤 저장해요." : submissionIssue ?? "직접 쓴 답안을 저장한 뒤 진단을 요청할 수 있어요."}</p><ActionBar label="답안 저장과 제출"><ActionButton id="tutor-submit" type="submit" tone="primary" availability={busy ? {kind:"busy",reason:"현재 요청 결과를 기다려 주세요."} : uncertain ? {kind:"blocked",reason:"앞선 저장 결과를 먼저 확인해 주세요."} : composing ? {kind:"blocked",reason:"한글 조합을 마쳐 주세요."} : submissionIssue ? {kind:"blocked",reason:submissionIssue} : {kind:"available"}}>답안 제출·저장</ActionButton>{retryAvailable && <ActionButton id="tutor-retry-save" type="button" tone="secondary" availability={busy ? {kind:"busy",reason:"같은 요청의 결과를 기다려 주세요."} : {kind:"available"}} onClick={onRetry}>같은 저장 요청 다시 확인</ActionButton>}</ActionBar><p className="tutor-field-hint">화면의 입력은 서버 저장 확인 전까지 영구 보관되지 않아요. 새로고침·강제 종료 전에는 저장 상태를 확인해 주세요.</p></form>}
      {view.help && <aside aria-label="요청한 도움"><h3>{tutorHelpLabels[view.help.stage]} · 이번에 받은 도움</h3><p>도움 사용이 기록되었어요.</p><HelpDelivery key={view.help.id} sessionId={view.id} helpId={view.help.id} deliveredAt={view.help.deliveredAt}/><h4>AI 추가 설명</h4><p>{view.help.explanation.text}</p>{view.help.explanation.citations.map((cite,index)=><blockquote key={index}>{cite.quote}<small>확인한 교재 인용</small></blockquote>)}</aside>}
      {view.answers.map((answer)=><article key={answer.id}><h4>제출한 답안</h4><p>{answer.text}</p><p>사진 {answer.fileIds.length}개 · {answer.helped ? "도움 사용" : "이 문제 도움 사용 없음"}</p></article>)}
      {view.phase==="answer-saved" && <TutorNewAiAction key={`${view.id}:${view.version}:diagnose`} view={view} action="diagnose" availability={aiAvailability} onRequest={():void=>onAction("diagnose")}/>}
      {conflict && <p role="alert">{TUTOR_DIAGNOSIS_CONFLICT_MESSAGE}</p>}{view.diagnosis && <article><h3>AI 진단 · 확정 수행 수준과 별도</h3><p>{view.diagnosis.observation}</p>{view.diagnosis.readability==="unreadable" && <p>사진을 판독하지 못했어요. 원본은 보존돼요. 설명을 더하거나 사진을 다시 제출해 주세요.</p>}</article>}
      {view.phase==="diagnosed" && <div className="tutor-actions">{!conflict && view.diagnosis?.needsHelp && <TutorNewAiAction key={`${view.id}:${view.version}:help`} view={view} action="help" availability={aiAvailability} onRequest={():void=>onAction("help")}/>}<TutorNewAiAction key={`${view.id}:${view.version}:variation`} view={view} action="variation" availability={conflict ? {kind:"blocked",reason:TUTOR_DIAGNOSIS_CONFLICT_MESSAGE} : aiAvailability} onRequest={():void=>onAction("variation")}/><button disabled={busy || composing || uncertain} onClick={():void=>onAction("finish")}>수업 마치기</button></div>}
      {["answer-saved","evaluating","diagnosed"].includes(view.phase) && <button disabled={busy || composing || uncertain} onClick={():void=>onAction("revise")}>답안 다시 쓰기</button>}
      {["answer-saved","evaluating"].includes(view.phase) && <button disabled={busy || composing || uncertain} onClick={():void=>onAction("finish")}>답안을 평가 대기로 보관하고 마치기</button>}
      {view.pending && <TutorPendingAi pending={view.pending} availability={busy || composing || uncertain ? {kind:"blocked",reason:"현재 입력·저장 요청을 마친 뒤 확인해 주세요."} : {kind:"available"}} onRecover={():void=>onAction("recover")}/>}
      {view.phase!=="finished" && <button disabled={busy || composing || uncertain} onClick={():void=>onAction("pause")}>잠시 멈추기</button>}
    </>}
    <TutorHelpHistory originalExposure={view.originalExposure} history={view.helpHistory} questionId={view.question.id}/>
  </section>;
}
