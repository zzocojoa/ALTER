import { AccessHomeLink, AccessScreen } from "@/components/alter/access-screen";
import { RestoreAccessBoundary } from "./restore-access-boundary";
import { PageHeader } from "@/components/alter/page-header";
import type { ReactElement } from "react";
import { env } from "cloudflare:workers";
import { forbidden, unauthorized } from "next/navigation";
import { getAuthenticatedOwnerDecision } from "@/lib/owner-access";
import { readRestoreConfiguration } from "@/lib/backup/restore-configuration";
import hosting from "@/.openai/hosting.json";
import { RestoreSourceClient } from "@/app/learn/backup/restore-source-client";
import { RestoreTargetClient } from "@/app/learn/backup/restore-target-client";
import "@/app/learn/backup/backup.css";
export const dynamic = "force-dynamic";
export default async function RestorePage(): Promise<ReactElement> {
  const access = await getAuthenticatedOwnerDecision(); if (access.kind === "unauthenticated") unauthorized(); if (access.kind === "forbidden") forbidden();
  if (access.kind !== "owner") return <AccessScreen title="복원 관리자 소유자 설정을 확인해 주세요" context="설정 확인 필요" detail="소유자 판정을 완료하지 못했어요. 설정을 확인한 뒤 다시 열어 주세요."><AccessHomeLink/></AccessScreen>;
  const config = readRestoreConfiguration(env.ALTER_RESTORE_CONFIGURATION);
  if (config === null) return <AccessScreen title="복원 관리자 설정이 아직 없습니다" context="복원 준비 필요" detail="원본과 별도 복원 대상의 설정이 필요해요. 기존 백업 파일은 백업 화면에서 받을 수 있어요."><a className="alter-link access-primary" href="/learn/backup">백업 받기</a><a className="alter-link" href="/learn/more">더보기로</a></AccessScreen>;
  return <RestoreAccessBoundary><main data-alter-ui className="site-shell"><PageHeader title="백업 복원 관리" context="소유자 전용 · 별도 저장소" back={{ href: "/learn/backup", label: "백업 받기로" }} action={null}/>{config.role === "source" ? <RestoreSourceClient/> : <RestoreTargetClient storageKey={`alter-restore:${hosting.project_id}:${env.ALTER_OWNER_USER_ID}`}/>}</main></RestoreAccessBoundary>;
}
