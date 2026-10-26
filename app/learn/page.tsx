import { UsageDisclosure } from "./usage-disclosure";
import { LearningDashboardClient } from "./dashboard-client";
import "./dashboard.css";
import { MaterialAcceptanceCheck } from "./materials/acceptance-check";
import { MaterialDownloadCheck } from "./materials/download-check-panel";
import type { ReactElement } from "react";
import { forbidden, unauthorized } from "next/navigation";
import { getOwnerDecision } from "@/lib/owner-access";
import { chatGPTSignInPath, chatGPTSignOutPath } from "../chatgpt-auth";
import { AiSupportCheck } from "./ai-support-check";
import { AiLedgerCheck } from "./ai-ledger-check";
import { DataCheck } from "./data-check";
import { MaterialStateCheck } from "./material-state-check";
import { MaterialTextCheck } from "./material-text-check";
import { MaterialJpegCheck } from "./material-jpeg-check";
import { MaterialPngCheck } from "./material-png-check";

export const dynamic = "force-dynamic";

export default async function LearningSpace(): Promise<ReactElement> {
  const decision = await getOwnerDecision();
  if (decision.kind === "unauthenticated") unauthorized();
  if (decision.kind === "forbidden") forbidden();
  if (decision.kind !== "owner") {
    return <main className="site-shell"><h1>{"소유자 설정이 필요해요"}</h1><p>인증이 확인되기 전에는 학습 기록과 파일을 열지 않습니다.</p><a href={chatGPTSignInPath("/learn")} target="_top">ChatGPT로 로그인</a></main>;
  }
  return <main className="site-shell"><p className="eyebrow">나만의 배움</p><h1>나의 학습 공간</h1><p>교재를 모으고 진단을 통해 나에게 맞는 학습계획을 준비해 보세요.</p><p>Google 연결 없이 자료를 등록하고 원본을 살펴볼 수 있어요. 진단·계획은 직접 검토해 확정하며, 수업에서 자기 말 답안과 도움 사용을 기록할 수 있어요. 결과물 개선에서 초안·수정 이유를 남기고 새 조건의 수행을 구분해요. 저장한 결과로 복습 일정을 정하고 주간 점검에서 다음 주 행동을 검토해요.</p><LearningDashboardClient /><nav className="learning-menu" aria-label="학습 메뉴"><p><a className="storage-check-button" href="/learn/materials">자료 보관함 열기</a></p><p><a className="storage-check-button" href="/learn/advisor">진단과 학습계획 열기</a></p><p><a className="storage-check-button" href="/learn/library">오늘의 학습 범위 정하기</a></p><p><a className="storage-check-button" href="/learn/tutor">한 걸음 수업 시작하기</a></p><p><a className="storage-check-button" href="/learn/editor">결과물 개선 열기</a></p><p><a className="storage-check-button" href="/learn/results">수업 결과 확인·확정</a></p><p><a className="storage-check-button" href="/learn/weekly">주간 점검 열기</a></p><p><a className="storage-check-button" href="/learn/google">Google 연결 관리</a></p></nav><p><a href="/learn/backup">백업과 복원</a></p><UsageDisclosure /><MaterialAcceptanceCheck /><MaterialDownloadCheck /><DataCheck /><AiLedgerCheck /><AiSupportCheck /><MaterialPngCheck /><MaterialJpegCheck /><MaterialTextCheck /><MaterialStateCheck /><p><a href="/api/session">인증 상태 확인</a></p><a href={chatGPTSignOutPath("/")} target="_top">로그아웃</a></main>;
}
