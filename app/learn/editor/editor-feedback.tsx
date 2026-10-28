"use client";
import type { ReactElement } from "react";
import { editorIssueLabels } from "@/lib/editor/presentation";
import type { EditorView } from "@/lib/editor/view";
import type { EditorVersion } from "@/lib/editor/contracts";

type Feedback = EditorView["feedbacks"][number];
type Location = Feedback["basis"][number]["location"];
const directions = {
  "check-definition": "사용한 개념의 뜻을 다시 확인하고 자기 말로 고쳐 보세요.",
  "explain-reason": "그렇게 생각한 이유와 중간 과정을 연결해 보세요.",
  "compare-condition": "문제에서 주어진 조건과 자신이 쓴 내용을 비교해 보세요.",
  "check-calculation": "각 계산 단계가 앞 단계와 이어지는지 확인해 보세요.",
  "clarify-writing": "읽기 어려운 부분을 또렷하게 적거나 설명을 덧붙여 보세요.",
} as const;

/** 저장된 피드백의 정확한 초안 구간만 보여 주며 현재 입력으로 바꾸지 않습니다. */
function FeedbackLocation({ location, version }: Readonly<{ location: Location; version: EditorVersion }>): ReactElement {
  if (location.kind === "text") {
    const chars: readonly string[] = Array.from(version.text);
    if (location.end <= location.start || chars.slice(location.start, location.end).join("") !== location.quote) throw new Error("피드백의 인용 구간이 저장된 초안과 다릅니다. 최신 개선 기록을 확인해 주세요.");
    return <div className="editor-evidence-text"><p className="alter-caption">내가 제출한 구간 · 문자 {location.start + 1}~{location.end}</p><blockquote>{location.quote}</blockquote><details><summary>제출한 글에서 위치 보기</summary><p>{chars.slice(0, location.start).join("")}<mark>{location.quote}</mark>{chars.slice(location.end).join("")}</p></details></div>;
  }
  const photo: number = version.fileIds.indexOf(location.fileId) + 1;
  if (photo === 0 || location.right <= location.left || location.bottom <= location.top) throw new Error("피드백 사진 구간이 저장된 첨부와 다릅니다. 최신 개선 기록을 확인해 주세요.");
  return <div className="editor-evidence-photo"><p>제출한 사진 {photo}의 표시 구간</p><svg viewBox="0 0 100 100" role="img" aria-label={`사진 ${photo}의 피드백 위치 안내. 사진 원본은 아래 링크에서 확인해요.`}><rect className="editor-photo-outline" x="1" y="1" width="98" height="98"/><rect className="editor-photo-region" x={location.left * 100} y={location.top * 100} width={(location.right - location.left) * 100} height={(location.bottom - location.top) * 100}/></svg><p className="alter-caption">위쪽·왼쪽을 기준으로 가로 {Math.round(location.left * 100)}~{Math.round(location.right * 100)}%, 세로 {Math.round(location.top * 100)}~{Math.round(location.bottom * 100)}% · 위치 안내이며 사진 원본은 아니에요.</p><a href={`/api/materials/${location.fileId}/file`} target="_blank" rel="noopener noreferrer">제출한 사진 {photo} 원본 열기 (새 탭)</a></div>;
}

function FeedbackRecord({ feedback, view }: Readonly<{ feedback: Feedback; view: EditorView }>): ReactElement {
  const version: EditorVersion | undefined = view.versions.find((item): boolean => item.id === feedback.versionId);
  if (!version) throw new Error("피드백에 연결된 초안 버전이 없습니다. 최신 개선 기록을 확인해 주세요.");
  const number: number = view.versions.indexOf(version) + 1;
  return <article id={`editor-feedback-${feedback.id}`} className="editor-feedback-record" aria-label={`초안 ${number}판 피드백`}>
    <h3>초안 {number}판 피드백</h3>
    <p className="alter-caption">제출한 글·사진의 저장 버전에 연결돼요. 피드백 도움 사용은 기록으로 남아요.</p>
    {feedback.needsRecheck && <p role="alert">이 피드백의 원문·기준이 정정되어 재검토가 필요해요. 과거 기록과 도움 사용 이력은 보존돼요.</p>}
    {feedback.items.length === 0 && <p>현재 초안에서 수정할 핵심 문제는 확인되지 않았어요. 새 조건에서 직접 수행하는 검증은 별도예요.</p>}
    {feedback.items.map((item, index): ReactElement => {
      const basis = feedback.basis[item.basisIndex];
      if (!basis) throw new Error("피드백의 근거 위치가 없습니다. 최신 개선 기록을 확인해 주세요.");
      return <section className="editor-feedback-item" key={index} aria-label={`핵심 ${index + 1}. ${editorIssueLabels[item.issue]}`}>
        <h4><span className="editor-feedback-number">핵심 {index + 1}</span> {editorIssueLabels[item.issue]}</h4>
        <FeedbackLocation location={basis.location} version={version}/>
        <div className="editor-feedback-direction"><h5>직접 고칠 방향</h5><p>{directions[item.direction]}</p></div>
        <dl className="editor-feedback-criterion"><dt>확인 기준</dt><dd>{basis.criterionQuote}</dd></dl>
        <nav aria-label={`핵심 ${index + 1}의 교재 근거`}><p className="alter-caption">확인한 교재 근거 {item.sourceRefIds.length}개</p>{item.sourceRefIds.map((id, sourceIndex): ReactElement => <a key={id} href={`/learn/source/${id}`} target="_blank" rel="noopener noreferrer">교재 근거 {sourceIndex + 1} 열기 (새 탭)</a>)}</nav>
      </section>;
    })}
  </article>;
}

export function EditorFeedback({ view, opened, onOpened }: Readonly<{ view: EditorView; opened: boolean; onOpened: (opened: boolean) => void }>): ReactElement | null {
  if (view.historyHidden) return null;
  const latest: Feedback | undefined = view.feedbacks.at(-1);
  if (!latest) return null;
  return <section className="editor-feedback" aria-label="초안에 연결된 피드백"><h2>지금 확인할 핵심 피드백</h2><FeedbackRecord feedback={latest} view={view}/>{view.feedbacks.length > 1 && <details className="editor-feedback-earlier" open={opened} onToggle={(event): void => onOpened(event.currentTarget.open)}><summary>이전 피드백 이력 ({view.feedbacks.length - 1})</summary>{view.feedbacks.slice(0, -1).map((feedback): ReactElement => <FeedbackRecord key={feedback.id} feedback={feedback} view={view}/>)}</details>}</section>;
}
