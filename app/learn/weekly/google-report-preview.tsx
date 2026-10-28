import type { ReactElement } from "react";
import type { WeeklyWorkspace } from "@/lib/weekly/workspace";
import { weeklyExportContent } from "@/lib/weekly/confirmation";

/** 저장된 보고서 필드만 미리 표시하며 조회나 렌더링으로 외부 요청을 만들지 않습니다. */
export function GoogleReportPreview({ state, dirty, covered }: Readonly<{ state: WeeklyWorkspace; dirty: boolean; covered: boolean }>): ReactElement | null {
  if (covered) return null;
  const proposal = state.proposal;
  const saved: boolean = proposal !== null && state.claims.length === proposal.claimIds.length && state.claims.every(claim => proposal.claimIds.includes(claim.id));
  const content = !dirty && saved ? weeklyExportContent(state) : null;
  return <section className="weekly-export-preview" aria-label="Google 전송 전 확인">
    <h3>Google 전송 전 확인</h3>
    <dl><div><dt>Docs 상세 보고서</dt><dd>ALTER 학습 보고서 폴더의 해당 주간 문서</dd></div><div><dt>Sheets 성과표</dt><dd>ALTER 주간 성과의 해당 주간 행</dd></div></dl>
    <p>첫 전송에서는 전용 폴더·문서·성과표를 만들고, 이후에는 검증된 대상을 재사용해요. 같은 주간의 새 확정본은 기존 문서와 행을 갱신해요. Picker에서 별도로 고른 파일로 바뀌지 않아요.</p>
    <p>학습 기간·단원·선택한 성과 근거·도움 사용 기록 요약·다음 행동·확정본 식별 정보를 보내요. 원문·전체 대화·답안 본문·내 메모는 보내지 않아요.</p>
    {content ? <details><summary>저장된 내용의 전송 미리보기</summary><p>{state.context.aggregate.period.start} 주간 · 현재 기록 {state.version}판 기준</p><div className="weekly-export-fields">{Object.entries({ 성과: content.achievements, 어려움: content.difficulties, 개선: content.improvements, "다음 행동": content.nextActions }).map(([title, text]) => <section key={title}><h4>{title}</h4><p>{text}</p></section>)}</div><p>도움 사용 여부와 횟수·단원은 위 근거 기록에서 확인할 수 있어요. Google 문서 링크는 전송 후 다시 읽어 검증한 뒤 표시해요.</p></details> : <p role="status">{dirty ? "수정한 내용을 저장하면 전송 미리보기를 다시 확인할 수 있어요." : "선택한 근거와 초안을 저장한 뒤 전송 내용을 확인해 주세요."}</p>}
    <p>미리보기와 내부 확정본 저장만으로 Google에 쓰지 않아요. ‘확정하고 내보내기 요청’ 또는 ‘Google 내보내기 이어서 진행’을 눌러야 전송해요.</p>
  </section>;
}
