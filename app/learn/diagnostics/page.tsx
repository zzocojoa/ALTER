import type { ReactElement } from "react";
import { env } from "cloudflare:workers";
import { forbidden, unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { PageHeader } from "@/components/alter/page-header";
import { DiagnosticTools } from "./tools";
import { DiagnosticDirectory } from "./directory";
import { ViewportDiagnostics } from "./viewport";

export const dynamic = "force-dynamic";

export default async function DiagnosticsPage(): Promise<ReactElement> {
  const access = await materialOwnerAccess();
  if (access.rejection !== null) { if (access.rejection.status === 401) unauthorized(); forbidden(); }
  return <main id="learn-main" tabIndex={-1} className="site-shell">
    <PageHeader title="소유자 진단" context="더보기 · 기능 검증" back={{ href: "/learn/more", label: "더보기로" }} action={null} />
    <p className="alter-body">필요한 검사를 직접 골라 실행해요. AI 연결 검사는 기존 승인 범위와 예산 제한을 따르며 비용이 발생할 수 있어요.</p>
    <ViewportDiagnostics />
    <DiagnosticDirectory googleAvailable={env.ALTER_GOOGLE_ACCEPTANCE_ENABLED === "task14-fixed-v1"}/>
    <DiagnosticTools />
  </main>;
}
