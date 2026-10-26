import { env } from "cloudflare:workers";
import { GoogleAcceptanceClient } from "./google-acceptance-client";
import type { ReactElement } from "react";
import { forbidden, unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readGoogleConnectionView } from "@/lib/google/server";
import { GoogleConnectionClient } from "./google-client";
export const dynamic = "force-dynamic";
export default async function GooglePage({ searchParams }: Readonly<{ searchParams: Promise<Readonly<{ connection?: string }>> }>): Promise<ReactElement> {
  const access = await materialOwnerAccess(); if (access.rejection) { if (access.rejection.status === 401) unauthorized(); forbidden(); }
  const view = await readGoogleConnectionView(access.owner);
  const outcome: string | null = (await searchParams).connection ?? null;
  return <main className="site-shell"><header className="site-header"><a className="wordmark" href="/learn">ALTER<span>.</span></a><a href="/learn/weekly">주간 점검</a></header><p className="eyebrow">선택한 자료, 확정한 기록</p><h1>Google 연결</h1><p>선택한 참고 자료를 가져오고, 확정한 보고서와 공부 일정을 Google에 보관할 수 있어요. ChatGPT 로그인과 별도로 연결해요.</p><p><a href="/learn/google/references">선택한 참고 자료 가져오기</a></p><p><a href="/learn/calendar">학습·복습 일정 관리</a></p><GoogleConnectionClient key={view.connection ? `${view.connection.connectionId}:${view.connection.generation}:${view.connection.state}` : "empty"} initial={view} outcome={outcome}/>{env.ALTER_GOOGLE_ACCEPTANCE_ENABLED === "task14-fixed-v1" && <GoogleAcceptanceClient connection={view.connection}/>}<p>무료 이용 조건과 사용량을 확인한 범위에서만 연결 작업을 실행해요. 새 AI 분석은 별도의 비용·승인 기준을 적용해요.</p></main>;
}
