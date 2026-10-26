import { ReviewAcceptanceCheck } from "./review-acceptance";
import { env } from "cloudflare:workers";
import { instant } from "@/lib/reviews/calendar";
import { readReviewOverview } from "@/db/repositories/review-overview";
import { ReviewClient } from "./review-client";
import type { ReactElement } from "react";
import { forbidden,unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readTutorOverview,readTutorView } from "@/lib/tutor/server";
import { TutorAcceptanceCheck } from "./acceptance-check";
import { TutorClient } from "./tutor-client";
import "./tutor.css";
export const dynamic="force-dynamic";
export default async function TutorPage({searchParams}:Readonly<{searchParams:Promise<Readonly<{id?:string}>>}>):Promise<ReactElement> {
  const access=await materialOwnerAccess();if(access.rejection){if(access.rejection.status===401) unauthorized();forbidden();}
  const overview=await readTutorOverview(access.owner);const selected=(await searchParams).id ?? overview.history[0]?.id;const view=selected ? await readTutorView(access.owner,selected) : null;
  const reviews=!view || view.phase==="finished" ? await readReviewOverview(env.DB,access.owner,instant.parse(new Date().toISOString()),"Asia/Seoul") : null;
  return <main className="site-shell"><header className="site-header"><a className="wordmark" href="/learn">ALTER<span>.</span></a><a href="/learn/library">오늘의 범위</a></header><p className="eyebrow">읽고, 가리고, 내 말로</p><h1>한 걸음 수업</h1><p>한 번에 질문 하나를 풀고, 저장한 답안으로 다음 도움을 정해요.</p><p><a href="/learn/results">저장한 수업 결과 확인·확정</a></p>{reviews && <ReviewClient initial={reviews}/>}<TutorClient key={selected ?? "empty"} initial={overview} initialView={view}/><TutorAcceptanceCheck/><ReviewAcceptanceCheck/></main>;
}
