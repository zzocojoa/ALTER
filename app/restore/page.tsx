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
  if (access.kind !== "owner") return <main className="site-shell"><h1>복원 관리자 소유자 설정을 확인해 주세요</h1></main>;
  const config = readRestoreConfiguration(env.ALTER_RESTORE_CONFIGURATION);
  return <main className="site-shell"><header className="site-header"><a className="wordmark" href="/learn">ALTER<span>.</span></a><a href="/learn/backup">백업 받기</a></header><h1>백업 복원 관리</h1>{config === null ? <p>복원 관리자 설정이 아직 없습니다.</p> : config.role === "source" ? <RestoreSourceClient/> : <RestoreTargetClient storageKey={`alter-restore:${hosting.project_id}:${env.ALTER_OWNER_USER_ID}`}/>}</main>;
}
