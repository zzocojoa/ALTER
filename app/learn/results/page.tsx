import type { ResultDraft } from "@/lib/results/contracts";
import type { ReactElement } from "react";
import { forbidden,unauthorized } from "next/navigation";
import { env } from "cloudflare:workers";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readResultSnapshot } from "@/db/repositories/result-draft";
import { readStorage,isDomainFailure } from "@/db/repositories/atomic";
import { ResultClient } from "./result-client";
import "./results.css";
export const dynamic="force-dynamic";
export default async function ResultsPage({searchParams}:Readonly<{searchParams:Promise<Readonly<{id?:string}>>}>):Promise<ReactElement> {
  const access=await materialOwnerAccess();if(access.rejection){if(access.rejection.status===401) unauthorized();forbidden();}
  const query=await searchParams;
  const history=await readStorage("result.history",()=>env.DB.prepare("SELECT id,version,json_extract(state,'$.start.bundle.unit.title') AS title FROM tutor_sessions WHERE owner_id=? AND json_extract(state,'$.phase') IN ('answer-saved','diagnosed','finished') ORDER BY rowid DESC LIMIT 30").bind(access.owner.userId).all<{id:string;version:number;title:string}>());
  const id=query.id ?? history.results[0]?.id;let draft:ResultDraft|null=null;let issue:string|null=null;try{draft=id ? (await readResultSnapshot(env.DB,access.owner,id)).draft : null;}catch(error:unknown){if(!isDomainFailure(error)) throw error;issue=error.code==="reference_conflict" ? "현재 수업에서 답안을 먼저 저장하거나 수업을 마친 뒤 결과를 확인해 주세요." : "서버 기록을 확인하지 못했어요. 새로고침 후 다시 확인하세요.";}
  return <main className="site-shell"><header className="site-header"><a className="wordmark" href="/learn">ALTER<span>.</span></a><a href="/learn/tutor">수업으로</a></header><p className="eyebrow">기록을 확인하고 다음 걸음으로</p><h1>수업 결과 확인</h1><p>서버에 저장된 답안과 도움 이력으로 만든 종료 초안이에요. 내용 확인 후 확정하면 공식 기록에 반영해요.</p><details><summary>저장된 회차 ({history.results.length})</summary><ul>{history.results.map((item)=><li key={item.id}><a href={`/learn/results?id=${item.id}`}>{item.title} · 회차 {item.version}판 · {item.id.slice(-4)}</a></li>)}</ul></details>{issue ? <p role="alert">{issue}</p> : draft ? <ResultClient initial={draft}/> : <p>먼저 수업에서 답안을 제출해 주세요.</p>}</main>;
}
