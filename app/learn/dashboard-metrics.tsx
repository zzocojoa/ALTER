import type { ReactElement } from "react";
import type { LearningDashboard } from "@/lib/dashboard/contracts";

/** 계획 시간과 최근 확정 결과만 집계하며 미측정 학습 시간이나 수행 수준을 추정하지 않습니다. */
export function DashboardMetrics({ data }: Readonly<{ data: LearningDashboard }>): ReactElement | null {
  if (data.visibility !== "visible") return null;
  const plannedMinutes: number = data.scopes.filter((scope): boolean => scope.current && scope.phase === "confirmed").reduce((minutes, scope): number => minutes + scope.minutes, 0);
  const completed: number = data.results.filter((result): boolean => result.record.progress === "완료").length;
  const independent: number = data.results.filter((result): boolean => result.record.performance === "독립 수행").length;
  return <section className="dashboard-metrics" aria-label="진도와 수행 요약"><dl>
    <div><dt>오늘 계획 시간</dt><dd>{plannedMinutes}<span>분</span></dd></div>
    <div><dt>완료 단원</dt><dd>{completed}<span>개</span></dd></div>
    <div><dt>독립 수행</dt><dd>{independent}<span>개</span></dd></div>
  </dl><p className="alter-caption">현재 표시된 범위와 최근 확정 결과 기준이에요. 계획 시간은 실제 학습 시간과 달라요.</p></section>;
}
