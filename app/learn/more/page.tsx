import { SettingsMenu } from "./settings-menu";
import "./settings.css";
import { PageHeader } from "@/components/alter/page-header";
import type { ReactElement } from "react";
import { forbidden, unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { chatGPTSignOutPath } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function MorePage(): Promise<ReactElement> {
  const access = await materialOwnerAccess();
  if (access.rejection !== null) { if (access.rejection.status === 401) unauthorized(); forbidden(); }
  return <main className="site-shell" id="learn-main" tabIndex={-1}>
    <PageHeader title="더보기" context="나의 설정과 관리" back={{ href: "/learn", label: "오늘로" }} action={null} />
    <p className="alter-body">사용량과 연결 상태를 확인하고 학습 자료를 관리해요.</p>
    <SettingsMenu signOutPath={chatGPTSignOutPath("/")} />
  </main>;
}
