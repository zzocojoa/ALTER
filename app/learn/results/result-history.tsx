import type { ReactElement } from "react";
import type { ResultHistoryItem } from "@/lib/results/history";

type ResultHistoryProps = Readonly<{ records: readonly ResultHistoryItem[]; selectedId: string | null }>;

function ResultHistoryLinks({ records, selectedId }: ResultHistoryProps): ReactElement {
  return <ul>{records.map((item): ReactElement => <li key={item.id}><a href={`/learn/results?id=${item.id}`} aria-current={item.id === selectedId ? "page" : undefined}><span>{item.title}</span><small>{item.confirmedOrdinal === null ? "사용자 미확정" : `공식 확정 ${item.confirmedOrdinal}판`} · 회차 {item.version}판 · {item.id.slice(-4)}</small></a></li>)}</ul>;
}

export function ResultHistory({ records, selectedId }: ResultHistoryProps): ReactElement {
  const confirmed: readonly ResultHistoryItem[] = records.filter((item): boolean => item.confirmedOrdinal !== null);
  const pending: readonly ResultHistoryItem[] = records.filter((item): boolean => item.confirmedOrdinal === null);
  return <section className="result-history-list" aria-label="수업 기록 찾기">
    <h2>확정된 수업 기록</h2>
    <p className="alter-caption">단원을 선택해 확정 당시의 진도·수행 수준과 현재 재검토 안내를 확인하세요.</p>
    {confirmed.length > 0 ? <ResultHistoryLinks records={confirmed} selectedId={selectedId}/> : <p>아직 확정된 수업 기록이 없어요.</p>}
    {pending.length > 0 && <details><summary>미확정 회차 ({pending.length})</summary><p className="alter-caption">아직 공식 기록에 반영되지 않은 회차예요.</p><ResultHistoryLinks records={pending} selectedId={selectedId}/></details>}
    <p className="alter-caption">최근 30개 회차에서 확인한 기록이에요.</p>
  </section>;
}
