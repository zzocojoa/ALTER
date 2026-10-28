import type { ReactElement } from "react";
import { StatusBadge } from "@/components/alter/status";

export type BackupSummary = Readonly<{ tables: number; pages: number; originals: number }>;
export function BackupProgress({ busy, failed, summary, requested }: Readonly<{ busy: boolean; failed: boolean; summary: BackupSummary | null; requested: boolean }>): ReactElement {
  return <ol className="backup-steps" aria-label="백업 보관 단계">
    <li data-backup-step="prepare"><h3>1. 백업 준비</h3><p>완료한 답안과 원본을 함께 보관해요. 다른 탭의 기록 수정을 마친 뒤 시작해 주세요.</p></li>
    <li data-backup-step="verify"><h3>2. 수신과 무결성 검증</h3><StatusBadge label={failed ? "완료 확인 안 됨" : summary !== null ? "수신·검증 완료" : busy ? "수신·검증 진행 중" : "시작 전"} tone={failed ? "warning" : summary !== null ? "success" : "neutral"}/>
      {summary !== null ? <p>기록 테이블 {summary.tables}개 · 기록 파일 {summary.pages}개 · 원본 {summary.originals}개를 명세와 대조했어요.</p> : <p>파일 크기와 체크섬을 대조해요. 누락·손상·접근 거부는 완료로 처리하지 않아요.</p>}</li>
    <li data-backup-step="download"><h3>3. 내 기기에 파일 보관</h3><StatusBadge label={requested ? "다운로드 요청 · 기기에서 확인 필요" : summary !== null ? "다운로드 가능" : "검증 후 가능"} tone={requested ? "warning" : "neutral"}/><p>버튼을 누른 뒤 브라우저의 다운로드 목록에서 TAR 파일이 보관됐는지 확인해 주세요. 앱에서는 기기 저장 완료를 확인할 수 없어요.</p></li>
  </ol>;
}
