import type { ReactElement } from "react";
import type { ResultHistoryItem } from "@/lib/results/history";

export function ResultHistory({ records, selectedId }: Readonly<{ records: readonly ResultHistoryItem[]; selectedId: string | null }>): ReactElement {
  return <details className="result-history-list"><summary>저장된 회차 ({records.length})</summary><p className="alter-caption">최근 30개 회차예요. 과거 회차를 열면 그때 확정한 판단과 현재의 재검토 안내를 함께 볼 수 있어요.</p><ul>{records.map((item): ReactElement => <li key={item.id}><a href={`/learn/results?id=${item.id}`} aria-current={item.id === selectedId ? "page" : undefined}><span>{item.title}</span><small>{item.confirmedOrdinal === null ? "사용자 미확정" : `공식 확정 ${item.confirmedOrdinal}판`} · 회차 {item.version}판 · {item.id.slice(-4)}</small></a></li>)}</ul></details>;
}
