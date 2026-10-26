import type { ReactElement } from "react";
import { forbidden, unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import hosting from "@/.openai/hosting.json";
import { BackupClient } from "./backup-client";
import "./backup.css";
export const dynamic = "force-dynamic";
export default async function BackupPage(): Promise<ReactElement> {
  const access = await materialOwnerAccess(); if (access.rejection) { if (access.rejection.status === 401) unauthorized(); forbidden(); }
  return <main className="site-shell"><header className="site-header"><a className="wordmark" href="/learn">ALTER<span>.</span></a><a href="/learn">학습 공간</a></header><p className="eyebrow">내 기록 보관</p><h1>백업과 복원</h1><BackupClient storageKey={`alter-backup:${hosting.project_id}:${access.owner.userId}`}/><section><h2>복원 검증</h2><p>코드 배포 버전 복귀와 데이터 복원은 별개입니다. 백업은 원본과 분리된 저장소에서 소유자·참조·파일 체크섬을 검증한 뒤에만 활성화합니다. 과거 비용 원장으로 새 AI 예산을 부여하거나 외부 작업을 자동 재실행하지 않아요.</p><p><a href="/restore">별도 저장소 복원 관리</a></p></section></main>;
}
