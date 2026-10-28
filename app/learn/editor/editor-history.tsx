"use client";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { useLocationFragment } from "@/lib/use-location-fragment";
import { CheckTarget } from "../check-target";
import type { EditorView } from "@/lib/editor/view";

type EditorHistoryProps = Readonly<{ view: EditorView; opened: boolean; onOpened: (opened: boolean) => void; onFeedback: () => void }>;

/** 이전 입력을 덮어쓰지 않고 저장 버전과 당시 기준만 조회합니다. */
export function EditorHistory({ view, opened, onOpened, onFeedback }: EditorHistoryProps): ReactElement | null {
  const fragment: string = useLocationFragment();
  const history = useRef<HTMLDetailsElement>(null);
  useEffect((): void => { if (fragment === "#check-editor-saved" && history.current) history.current.open = true; }, [fragment, view.tutor.id]);
  if (view.historyHidden || view.versions.length === 0) return null;
  return <CheckTarget id="check-editor-saved" instruction={`① 저장된 초안 · 기록 ${view.tutor.version}판. 아래 문장이 그대로 보이는지 확인해 주세요.`}><details ref={history} open={opened} onToggle={(event): void => onOpened(event.currentTarget.open)}><summary>초안·수정 이유 이력 ({view.versions.length})</summary>{view.versions.map((item, index): ReactElement => <article key={item.id} aria-label={index === 0 ? "원본 초안" : `수정본 ${index}판`}>
    <h3>{index === 0 ? "원본 초안" : `수정본 ${index}판`}</h3><p>{item.text}</p><p>사진 {item.fileIds.length}개</p>{item.fileIds.map((id, photo): ReactElement => <p key={id}><a href={`/api/materials/${id}/file`} target="_blank" rel="noopener noreferrer">이 버전의 사진 {photo + 1} 원본 열기 (새 탭)</a></p>)}{item.reason && <p>수정 이유: {item.reason}</p>}<p>{item.parentId ? "직전 버전과 피드백에 연결됨 · 도움 사용" : "최초 제출 보존"}</p><p className="alter-caption">당시 단원 기준 {item.unitVersion}판 · 계획 기록 {item.planVersionId}</p>{item.feedbackId && <a href={`#editor-feedback-${item.feedbackId}`} onClick={onFeedback}>이 수정의 기준 피드백으로 이동</a>}
  </article>)}</details>{["draft", "awaiting-revision"].includes(view.phase) && <a className="editor-history-return" href="#editor-text">작성 중인 입력으로 돌아가기 ↑</a>}{fragment === "#check-editor-saved" && <a className="check-return" href="/learn#check-navigation">← 두 가지 확인 화면으로</a>}</CheckTarget>;
}
