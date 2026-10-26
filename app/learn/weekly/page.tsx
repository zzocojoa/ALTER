import type { ReactElement } from "react";
import { forbidden,unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readWeeklyOverview,readWeeklyView } from "@/lib/weekly/server";
import { WeeklyAcceptanceCheck } from "./acceptance-check";
import { WeeklyClient } from "./weekly-client";
import "./weekly.css";
export const dynamic="force-dynamic";
export default async function WeeklyPage({searchParams}:Readonly<{searchParams:Promise<Readonly<{id?:string}>>}>):Promise<ReactElement>{
  const access=await materialOwnerAccess();if(access.rejection){if(access.rejection.status===401) unauthorized();forbidden();}
  const overview=await readWeeklyOverview(access.owner);const selected=(await searchParams).id ?? overview.history[0]?.id;const view=selected ? await readWeeklyView(access.owner,selected) : null;
  return <main className="site-shell"><header className="site-header"><a className="wordmark" href="/learn">ALTER<span>.</span></a><a href="/learn/tutor">수업과 복습</a></header><p className="eyebrow">한 주의 근거, 다음 한 걸음</p><h1>주간 점검</h1><p>실제 답안과 도움 사용 기록을 살펴보고 다음 주에 할 일을 정해요.</p><WeeklyClient key={view ? `${view.state.id}:${view.state.version}` : "empty"} overview={overview} initial={view}/><WeeklyAcceptanceCheck/></main>;
}
