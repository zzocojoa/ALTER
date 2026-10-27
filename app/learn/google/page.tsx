import { ContextDiagnostics } from "../diagnostics/context-diagnostics";
import { PageHeader } from "@/components/alter/page-header";
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
  return <main id="learn-main" tabIndex={-1} className="site-shell"><PageHeader title="Google 연결" context="더보기 · 연결 관리" back={{ href: "/learn/more", label: "더보기로" }} action={null} /><p>선택한 참고 자료를 가져오고, 확정한 보고서와 공부 일정을 Google에 보관할 수 있어요. ChatGPT 로그인과 별도로 연결해요.</p><p><a href="/learn/google/references">선택한 참고 자료 가져오기</a></p><p><a href="/learn/calendar">학습·복습 일정 관리</a></p><GoogleConnectionClient key={view.connection ? `${view.connection.connectionId}:${view.connection.generation}:${view.connection.state}` : "empty"} initial={view} outcome={outcome}/>{env.ALTER_GOOGLE_ACCEPTANCE_ENABLED === "task14-fixed-v1" && <ContextDiagnostics id="diagnostic-google" title="Google 연결과 전송"><GoogleAcceptanceClient connection={view.connection}/></ContextDiagnostics>}<p>무료 이용 조건과 사용량을 확인한 범위에서만 연결 작업을 실행해요. 새 AI 분석은 별도의 비용·승인 기준을 적용해요.</p></main>;
}
