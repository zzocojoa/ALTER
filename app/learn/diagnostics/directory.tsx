import type { ReactElement } from "react";
import "./diagnostics.css";

const learningTools: readonly Readonly<{ href: string; label: string }>[] = [
  { href: "/learn/advisor#diagnostic-advisor", label: "진단과 학습계획 검사" },
  { href: "/learn/library#diagnostic-library", label: "자료 선정 검사" },
  { href: "/learn/tutor#diagnostic-tutor", label: "수업과 도움 검사" },
  { href: "/learn/editor#diagnostic-editor", label: "초안과 첨삭 검사" },
  { href: "/learn/tutor#diagnostic-reviews", label: "복습 검사" },
  { href: "/learn/weekly#diagnostic-weekly", label: "주간 점검 검사" },
];
export function DiagnosticDirectory({ googleAvailable }: Readonly<{ googleAvailable: boolean }>): ReactElement {
  return <nav className="diagnostic-directory" aria-label="검사 도구 찾기"><h2 className="alter-subheading">검사 도구 찾기</h2><p className="alter-body">기록을 만드는 검사와 API 비용이 발생하는 검사는 각 실행 버튼의 안내를 먼저 확인해 주세요.</p>
    <div className="diagnostic-links"><a className="alter-link" href="#diagnostic-materials">자료 등록·원본·전송 검사</a><a className="alter-link" href="#diagnostic-data">데이터 저장 검사</a><a className="alter-link" href="#diagnostic-ai">AI 연결·비용 원장 검사</a></div>
    <h3>학습 흐름 검사</h3><p>해당 학습 화면의 소유자 진단 영역을 열어요. 기존 검사 기록과 API를 그대로 사용해요.</p><ul>{learningTools.map(tool => <li key={tool.href}><a className="alter-link" href={tool.href}>{tool.label}</a></li>)}</ul>
    {googleAvailable ? <a className="alter-link" href="/learn/google#diagnostic-google">Google 연결·전송 검사</a> : <p className="alter-caption">Google 고정 검사는 현재 서버에서 활성화되지 않았어요.</p>}
    <a className="alter-link" href="/learn#check-budget">실행 전 비용·연결 상태 확인</a>
  </nav>;
}
