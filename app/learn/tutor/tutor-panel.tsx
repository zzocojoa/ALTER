"use client";
import { hasTutorDiagnosisConflict,TUTOR_DIAGNOSIS_CONFLICT_MESSAGE } from "@/lib/tutor/diagnosis";
import { ServiceFailureHelp } from "../service-availability";
import { ReviewFields } from "./review-fields";
import type { ReactElement } from "react";
import { HelpDelivery } from "./help-delivery";
import type { TutorView } from "@/lib/tutor/view";

export type TutorPanelAction = "lesson" | "recall" | "direct" | "diagnose" | "revise" | "pause" | "resume" | "help" | "variation" | "finish" | "recover";
export type TutorPanelProps = Readonly<{view:TutorView;text:string;busy:boolean;saved:boolean;error:string;onText:(text:string)=>void;onSubmit:()=>void;onAction:(action:TutorPanelAction)=>void;onFile:(file:File)=>void;fileNames:readonly string[]}>;
export function TutorPanel({view,text,busy,saved,error,onText,onSubmit,onAction,onFile,fileNames}:TutorPanelProps):ReactElement {
  const conflict:boolean=hasTutorDiagnosisConflict(view.diagnosis);
  const waiting:boolean=view.phase==="awaiting-answer";
  return <section className="tutor-panel" aria-label="현재 수업"><header><h2>{view.title}</h2><p>기록 {view.version}판 · 오늘 복습 {view.dueCount}개</p></header>
    {view.issue && <p role="alert">{view.issue}</p>}{view.startIssues.map((issue)=><p key={issue}>{issue==="missing-next-action" ? "이전 회차의 다음 행동은 아직 확인되지 않았어요." : issue==="correction-recheck" ? "정정된 내용은 새 수행으로 재확인해야 해요." : "복습 일정의 근거 버전은 재확인이 필요해요."}</p>)}
    {error && <p id="tutor-input-error" role="alert">{error} 입력한 답안은 지우지 않았어요.</p>}{error && <ServiceFailureHelp/>}
    {view.phase==="paused" ? <><p>수업을 잠시 멈췄어요. 같은 질문에서 이어갈 수 있어요.</p><button disabled={busy} onClick={():void=>onAction("resume")}>수업 이어가기</button></> : <>
      {view.nextAction && <p>이전 회차의 다음 행동: {view.nextAction}</p>}
      {view.phase==="explanation" && <>{view.sources.map((source)=><blockquote key={source.id}><p>{source.evidence}</p><cite>확인한 교재 · 파일 {source.filePage}페이지{source.printedPage ? ` · 인쇄 ${source.printedPage}쪽` : ""}</cite><a href={`/learn/source/${source.id}`}>이 교재 원본 위치 보기</a></blockquote>)}{view.lesson ? <><h3>AI 추가 설명</h3><p>{view.lesson.text}</p><button disabled={busy} onClick={():void=>onAction("recall")}>자료와 설명 가리고 시작</button></> : <button disabled={busy || view.pending!==null || !view.current} onClick={():void=>onAction("lesson")}>작은 개념 설명 받기</button>}<button disabled={busy} onClick={():void=>onAction("direct")}>설명 없이 직접 답안 쓰기</button></>}
      {view.phase==="finished" && <><p>수업 기록을 보관했어요. 답안·도움 사용 이력은 유지돼요.</p><a href={`/learn/results?id=${view.id}`}>이 수업 결과 확인·확정</a></>}
      {view.phase!=="explanation" && view.phase!=="finished" && <><p className="tutor-privacy">자료와 이전 AI 설명을 가렸어요. 지금 질문 하나에 자기 말로 답해 주세요.</p><h3 data-testid="tutor-question">{view.help?.learnerPrompt ?? view.question.prompt}</h3></>}
      {view.help && <aside aria-label="요청한 도움"><p>도움 사용이 기록되었어요.</p><HelpDelivery key={view.help.id} sessionId={view.id} helpId={view.help.id}/><h4>AI 추가 설명</h4><p>{view.help.explanation.text}</p>{view.help.explanation.citations.map((cite,index)=><blockquote key={index}>{cite.quote}<small>확인한 교재 인용</small></blockquote>)}</aside>}
      {waiting && <form onSubmit={(event):void=>{event.preventDefault();onSubmit();}}>{view.review && view.question.mode!=="new-condition" ? <ReviewFields type={view.review.task.type} text={text} busy={busy} onText={onText}/> : <><label htmlFor="tutor-answer">나의 답안</label><textarea aria-describedby={error ? "tutor-draft-status tutor-input-error" : "tutor-draft-status"} id="tutor-answer" value={text} maxLength={60000} onChange={(event):void=>onText(event.target.value)} disabled={busy} rows={7}/></>}<label>풀이 사진<input aria-describedby={error ? "tutor-draft-status tutor-input-error" : "tutor-draft-status"} type="file" accept="image/png,image/jpeg" disabled={busy || fileNames.length>=4} onChange={(event):void=>{const file=event.target.files?.[0];event.currentTarget.value="";if(file) onFile(file);}}/></label><p>PNG·JPG 원본은 8MiB까지 저장해요. AI 판독은 사진당 2MiB·합계 4MiB 이내예요. 전송이 중단되면 같은 사진을 다시 선택해 이어갈 수 있어요.</p>{fileNames.map((name,index)=><p key={index}>첨부: {name}</p>)}<p id="tutor-draft-status" role="status">{saved ? "초안 저장됨" : "입력 내용을 저장 중이거나 저장 확인이 필요해요."}</p><button disabled={busy || text.trim().length===0 && fileNames.length===0}>답안 제출·저장</button></form>}
      {view.answers.map((answer)=><article key={answer.id}><h4>제출한 답안</h4><p>{answer.text}</p><p>사진 {answer.fileIds.length}개 · {answer.helped ? "도움 사용" : "이 문제 도움 사용 없음"}</p></article>)}
      {view.phase==="answer-saved" && <button disabled={busy || !view.current} onClick={():void=>onAction("diagnose")}>저장한 답안 진단</button>}
      {conflict && <p role="alert">{TUTOR_DIAGNOSIS_CONFLICT_MESSAGE}</p>}{view.diagnosis && <article><h3>AI 진단 · 확정 수행 수준과 별도</h3><p>{view.diagnosis.observation}</p>{view.diagnosis.readability==="unreadable" && <p>사진을 판독하지 못했어요. 원본은 보존돼요. 설명을 더하거나 사진을 다시 제출해 주세요.</p>}</article>}
      {view.phase==="diagnosed" && <div className="tutor-actions">{!conflict && view.diagnosis?.needsHelp && <button disabled={busy || view.pending!==null || !view.current} onClick={():void=>onAction("help")}>다음 단계 도움 요청</button>}<button disabled={busy || conflict || view.pending!==null || !view.current} onClick={():void=>onAction("variation")}>새 조건 과제 요청</button><button disabled={busy} onClick={():void=>onAction("finish")}>수업 마치기</button></div>}
      {["answer-saved","evaluating","diagnosed"].includes(view.phase) && <button disabled={busy} onClick={():void=>onAction("revise")}>답안 다시 쓰기</button>}
      {["answer-saved","evaluating"].includes(view.phase) && <button disabled={busy} onClick={():void=>onAction("finish")}>답안을 평가 대기로 보관하고 마치기</button>}
      {view.pending && <p role="status">AI 요청 확인 대기<button disabled={busy} onClick={():void=>onAction("recover")}>기존 요청 결과 확인</button></p>}
      {view.phase!=="finished" && <button disabled={busy} onClick={():void=>onAction("pause")}>잠시 멈추기</button>}
    </>}
  </section>;
}
