import type { ReactElement } from "react";
import { StatusBadge } from "@/components/alter/status";
import type { BrowserRestoreOutcome } from "@/lib/backup/browser-restore";

export function RestoreSteps({ outcome, busy }: Readonly<{ outcome: BrowserRestoreOutcome | null; busy: boolean }>): ReactElement {
  return <ol className="backup-steps" aria-label="복원 단계">
    <li><h3>1. 대상 확인과 승인</h3><p>빈 저장소에서 요청 파일을 만들고, 원본 사이트에서 완료 백업 하나에 대한 승인을 받아요.</p></li>
    <li><h3>2. 격리 상태로 검증</h3><StatusBadge label={outcome ? "저장된 검증 통과" : busy ? "작업 확인 중" : "검증 결과 미확인"} tone={outcome ? "success" : "neutral"}/><p>백업·소유자·참조·원본 체크섬이 일치하는지 확인해요. 검증 통과만으로 학습 화면이 열리지는 않아요.</p></li>
    <li><h3>3. 학습 기록 활성화</h3><StatusBadge label={outcome?.state === "activated" ? "학습 기록 활성화 확인" : outcome?.state === "verified" ? "검증 통과 · 활성화 전" : "검증 후 진행 가능"} tone={outcome?.state === "activated" ? "success" : "warning"}/><p>별도 버튼으로 활성화해요. AI 예산과 Google 실행 권한은 다시 확인해야 해요.</p></li>
  </ol>;
}
export function RestoreSummary({ outcome }: Readonly<{ outcome: BrowserRestoreOutcome }>): ReactElement {
  return <section className="restore-summary" aria-label="서버 검증 결과"><h3>서버 검증 결과</h3><dl><div><dt>원본 사이트</dt><dd>{outcome.sourceProject}</dd></div><div><dt>복원 대상</dt><dd>{outcome.targetProject}</dd></div><div><dt>완료 백업 ID</dt><dd>{outcome.backupId}</dd></div><div><dt>검증한 기록·원본</dt><dd>{outcome.counts.rows}개 행 · {outcome.counts.pages}개 기록 파일 · {outcome.counts.originals}개 원본</dd></div></dl><p>서명·인증 토큰은 화면에 표시하지 않아요.</p></section>;
}
