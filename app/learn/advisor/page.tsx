import type { ReactElement } from "react";
import { forbidden, unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readAdvisorPage } from "@/lib/advisor/server";
import { AdvisorClient } from "./advisor-client";
import "./advisor.css";
import { AdvisorAcceptanceCheck } from "./acceptance-check";

export const dynamic = "force-dynamic";
export default async function AdvisorPage(): Promise<ReactElement> {
  const access = await materialOwnerAccess();
  if (access.rejection) {
    if (access.rejection.status === 401) unauthorized();
    if (access.rejection.status === 403) forbidden();
    return <main className="site-shell"><h1>소유자 설정을 확인해 주세요</h1></main>;
  }
  return <main className="site-shell advisor-page"><header className="site-header"><a className="wordmark" href="/learn">ALTER<span>.</span></a><a href="/learn/materials">자료 보관함</a></header><p className="eyebrow">나에게 맞는 시작</p><h1>진단과 학습계획</h1><p>학습 조건을 정하고, 설명과 풀이를 하나씩 제출해 보세요. 계획은 직접 검토하고 확정합니다.</p><AdvisorClient {...await readAdvisorPage(access.owner)} /><p><a href="/learn/library">확정 계획으로 오늘의 학습 범위 정하기 →</a></p><AdvisorAcceptanceCheck /></main>;
}
