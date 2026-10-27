"use client";
import type { ReactElement } from "react";
import { AnswerInput } from "../tutor/answer-input";
import { SaveStatus } from "@/components/alter/status";
import type { SaveState } from "@/lib/ui/save-status";
import { ActionButton } from "@/components/alter/action-button";
import type { EditorView } from "@/lib/editor/view";

type EditorInputProps = Readonly<{ view: EditorView; text: string; reason: string; fileNames: readonly string[]; busy: boolean; inputBusy: boolean; uncertain: boolean; saveState: SaveState; submitting: boolean; composing: boolean; saved: boolean; error: string; onText: (value: string) => void; onReason: (value: string) => void; onComposition: (active: boolean) => void; onSubmit: () => void; onFile: (file: File) => void }>;

export function editorDraftIssue(text: string, reason: string): string | null {
  if (text.length > 60000) return "초안·수정본을 60,000자 이내로 줄여 주세요. 입력은 이 화면에 유지해요.";
  if (reason.length > 4000) return "수정 이유를 4,000자 이내로 줄여 주세요. 입력은 이 화면에 유지해요.";
  return null;
}

/** 수정본과 이유는 같은 입력 소유자에 두며 화면 폭에 따라 다시 생성하지 않습니다. */
export function EditorInput({ view, text, reason, fileNames, busy, inputBusy, uncertain, saveState, submitting, composing, error, onText, onReason, onComposition, onSubmit, onFile }: EditorInputProps): ReactElement {
  const revision: boolean = view.phase === "awaiting-revision";
  const issue: string | null = editorDraftIssue(text, reason);
  const blocked: string | null = uncertain ? "앞선 저장 결과를 먼저 확인해 주세요." : composing ? "한글 입력을 마친 뒤 제출해 주세요." : issue ?? (!text.trim() && fileNames.length === 0 ? "글을 작성하거나 사진을 첨부해 주세요." : revision && !reason.trim() ? "무엇을 왜 바꿨는지 수정 이유를 적어 주세요." : null);
  const describedBy: string = error ? "editor-draft-status editor-input-error" : "editor-draft-status";
  return <form id="editor-answer-area" className="editor-input-card" tabIndex={-1} aria-label={revision ? "수정본과 이유 작성" : "초안 작성"} onSubmit={(event): void => { event.preventDefault(); if (!blocked && !busy) onSubmit(); }}>
    <h2>{revision ? "직접 고쳐 쓰기" : "나의 초안 작성"}</h2>
    <p className="alter-caption">{revision ? "피드백을 참고해 직접 수정하고, 바로 아래에 바꾼 이유를 함께 적어요." : "글이나 사진으로 먼저 작성해요. 초안 저장과 AI 피드백 요청은 별도예요."}</p>
    <div className="editor-input-pair">
      <AnswerInput id="editor-text" label={revision ? "나의 수정본" : "나의 초안"} value={text} limit={60000} required={false} describedBy={describedBy} busy={inputBusy || uncertain} onValue={onText} onComposition={onComposition}/>
      {revision && <AnswerInput id="editor-reason" label="수정 이유" value={reason} limit={4000} required={true} describedBy={describedBy} busy={inputBusy || uncertain} onValue={onReason} onComposition={onComposition}/>}
    </div>
    {revision && <p className="alter-caption">무엇을 왜 고쳤는지 직접 적어 주세요. 수정본과 이유를 모두 저장한 뒤 재검토해요.</p>}
    <section className="editor-photo-field" aria-label="초안·수정본 사진 첨부"><label htmlFor="editor-photo">초안·수정본 사진 <span className="alter-caption">선택 · 최대 4개</span></label><input id="editor-photo" aria-describedby={`${describedBy} editor-photo-limits`} type="file" accept="image/png,image/jpeg" disabled={busy || uncertain || composing || fileNames.length >= 4} onChange={(event): void => { const file: File | undefined = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) onFile(file); }}/>{fileNames.map((name, index): ReactElement => <p key={index}>첨부: {name}</p>)}<p id="editor-photo-limits" className="alter-caption">원본 사진은 8MiB까지 보관해요. AI 판독은 사진당 2MiB·합계 4MiB 이내예요. 사진 첨부만으로 AI를 호출하지 않아요.</p></section>
    <div className="editor-save-notice">{composing || submitting ? <p id="editor-draft-status" role="status" data-persistence="unconfirmed">{composing ? "한글을 입력하고 있어요. 조합이 끝난 뒤 저장해요." : "수정 입력을 제출하고 있어요. 아직 제출 완료는 아니에요."}</p> : <SaveStatus id="editor-draft-status" state={saveState}/>}</div>
    <ActionButton id="editor-submit" type="submit" tone="primary" availability={busy ? { kind: "busy", reason: "저장 요청을 확인하고 있어요" } : blocked ? { kind: "blocked", reason: blocked } : { kind: "available" }} onClick={(): void => undefined}>{revision ? "수정본과 이유 제출·저장" : "초안 제출·저장"}</ActionButton><p className="alter-caption">서버 저장 확인 전의 입력은 이 화면에만 있어요. 새로고침·강제 종료 전 저장 상태를 확인해 주세요.</p>
  </form>;
}
