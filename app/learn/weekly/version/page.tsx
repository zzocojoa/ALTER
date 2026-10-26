import type { ReactElement } from "react";
import { env } from "cloudflare:workers";
import { forbidden,unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readWeeklyFrozen } from "@/db/repositories/weekly-confirmation";
import { WeeklyFrozenClient } from "./frozen-client";
import "../weekly.css";
export const dynamic="force-dynamic";
export default async function WeeklyVersionPage({searchParams}:Readonly<{searchParams:Promise<Readonly<{id?:string}>>}>):Promise<ReactElement> {
  const access=await materialOwnerAccess();if(access.rejection){if(access.rejection.status===401) unauthorized();forbidden();}const id=(await searchParams).id;if(!id) return <main className="site-shell"><h1>확정본을 선택해 주세요</h1><a href="/learn/weekly">주간 점검으로</a></main>;
  const frozen=await readWeeklyFrozen(env.DB,env.BUCKET,access.owner,id);
  return <WeeklyFrozenClient initial={frozen}/>;
}
