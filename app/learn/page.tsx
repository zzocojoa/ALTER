import type { ReactElement } from "react";
import { forbidden, unauthorized } from "next/navigation";
import { PageHeader } from "@/components/alter/page-header";
import { getOwnerDecision } from "@/lib/owner-access";
import { chatGPTSignInPath } from "../chatgpt-auth";
import { LearningDashboardClient } from "./dashboard-client";
import { HomeCheckCompatibility } from "./home-check-compatibility";
import "./dashboard.css";

export const dynamic = "force-dynamic";

export default async function LearningSpace(): Promise<ReactElement> {
  const decision = await getOwnerDecision();
  if (decision.kind === "unauthenticated") unauthorized();
  if (decision.kind === "forbidden") forbidden();
  if (decision.kind !== "owner") return <main id="learn-main" tabIndex={-1} className="site-shell"><h1>소유자 설정이 필요해요</h1><p>인증이 확인되기 전에는 학습 기록과 파일을 열지 않습니다.</p><a href={chatGPTSignInPath("/learn")} target="_top">ChatGPT로 로그인</a></main>;
  return <main id="learn-main" tabIndex={-1} className="site-shell">
    <PageHeader title="오늘의 한 걸음" context="나만의 배움" back={null} action={null} />
    <p className="alter-body">지금 할 일을 여기에서 바로 열어요.</p>
    <LearningDashboardClient />
    <details className="dashboard-more"><summary>진단·계획·기록 더보기</summary><nav className="learning-menu" aria-label="계획과 기록">
      <a className="alter-link" href="/learn/advisor">진단과 학습계획</a>
      <a className="alter-link" href="/learn/library">오늘의 범위 정하기</a>
      <a className="alter-link" href="/learn/tutor">수업과 복습</a>
      <a className="alter-link" href="/learn/editor">결과물 개선</a>
      <a className="alter-link" href="/learn/results">수업 결과 확인·확정</a>
      <a className="alter-link" href="/learn/weekly">주간 점검</a>
      <a className="alter-link" href="/learn/calendar">학습 일정</a>
    </nav></details>
    <HomeCheckCompatibility />
  </main>;
}
