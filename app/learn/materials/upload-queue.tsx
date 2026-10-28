import type { ReactElement } from "react";
import type { UploadQueueEntry } from "./upload-selection";

const labels: Readonly<Record<UploadQueueEntry["status"], string>> = { waiting: "대기", registering: "등록 중", registered: "등록 완료", attention: "확인 필요" };

export function UploadQueue({ entries }: Readonly<{ entries: readonly UploadQueueEntry[] }>): ReactElement | null {
  if (entries.length === 0) return null;
  const completed: number = entries.filter((entry): boolean => entry.status === "registered").length;
  return <section className="alter-upload-queue" aria-label="파일별 등록 상태">
    <p role="status" aria-live="polite">{entries.length}개 중 {completed}개 등록 완료</p>
    <ol>{entries.map((entry): ReactElement => <li key={entry.key} data-upload-state={entry.status}><div><strong>{entry.metadata.title}</strong><span>{labels[entry.status]}</span></div>{entry.error !== null && <p className="alter-caption">{entry.error}</p>}</li>)}</ol>
    {completed < entries.length && <p className="alter-caption">확인 필요 항목을 해결한 뒤 ‘자료 등록하기’를 누르면 남은 파일만 이어서 등록해요. 새로고침하면 대기 목록은 사라지지만, 등록된 원본과 서버의 미확정 요청은 보관해요.</p>}
  </section>;
}
