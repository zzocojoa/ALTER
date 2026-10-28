import { ContextDiagnostics } from "../diagnostics/context-diagnostics";
import { PageHeader } from "@/components/alter/page-header";
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
  return <main id="learn-main" tabIndex={-1} className="site-shell"><PageHeader title="주간 점검" context="기록 · 다음 주 준비" back={{ href: "/learn/results", label: "확정 결과로" }} action={null} /><p>실제 답안과 도움 사용 기록을 살펴보고 다음 주에 할 일을 정해요.</p><WeeklyClient key={view ? `${view.state.id}:${view.state.version}` : "empty"} overview={overview} initial={view}/><ContextDiagnostics id="diagnostic-weekly" title="주간 점검"><WeeklyAcceptanceCheck/></ContextDiagnostics></main>;
}
