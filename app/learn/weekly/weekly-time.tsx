import type { ReactElement } from "react";
import type { WeeklyAllocation } from "@/lib/weekly/planning";
import type { ConfirmedUnit } from "@/lib/librarian/contracts";

/** 기존 배정 결과만 합산하며 미배정 활동을 남은 시간만큼 잘라 배정하지 않습니다. */
export function WeeklyTime({ allocation, units }: Readonly<{ allocation: WeeklyAllocation; units: readonly ConfirmedUnit[] }>): ReactElement {
  if (allocation.items.some(entry => !units.some(unit => unit.unitId === entry.item.targetUnitId))) throw new Error("시간 배정에 연결된 단원이 없습니다. 주간 기록을 다시 확인해 주세요.");
  const targets = units.filter(unit => allocation.items.some(entry => entry.item.targetUnitId === unit.unitId));
  return <section className="weekly-time" aria-label="다음 주 시간 배정"><p><strong>저장된 시간 배정</strong></p><dl className="weekly-time-totals"><div><dt>가용 시간</dt><dd>{allocation.availableMinutes}분</dd></div><div><dt>예상 소요</dt><dd>{allocation.estimatedMinutes}분</dd></div><div><dt>배정 시간</dt><dd>{allocation.allocatedMinutes}분</dd></div><div><dt>남은 가용 시간</dt><dd>{allocation.availableMinutes - allocation.allocatedMinutes}분</dd></div></dl>
    <p>마지막으로 저장한 초안 기준이에요. 시간 배정만으로 기존 복습 일정을 바꾸지 않아요.</p>
    {targets.length === 0 ? <p>배정할 활동이 없어요.</p> : <ul className="weekly-time-units">{targets.map(unit => {
      const entries = allocation.items.filter(entry => entry.item.targetUnitId === unit.unitId);
      const estimated: number = entries.reduce((total, entry) => total + entry.item.estimatedMinutes, 0);
      const assigned: number = entries.reduce((total, entry) => total + entry.allocatedMinutes, 0);
      const unassigned: number = entries.filter(entry => entry.status === "unassigned").length;
      return <li key={unit.unitId}><strong>{unit.title}</strong><span>예상 {estimated}분 · 배정 {assigned}분 · 미배정 활동 {unassigned}개</span></li>;
    })}</ul>}
    {allocation.items.some(entry => entry.status === "unassigned") && <p className="weekly-time-warning">가용 시간에 들어가지 않는 활동은 전체를 미배정으로 남겼어요. 배정된 활동과 구분해 검토해 주세요.</p>}
  </section>;
}
