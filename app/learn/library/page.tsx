import { ContextDiagnostics } from "../diagnostics/context-diagnostics";
import { PageHeader } from "@/components/alter/page-header";
import type { ReactElement } from "react";
import { env } from "cloudflare:workers";
import { recordId } from "@/lib/domain/contracts";
import { listConfirmedUnits } from "@/db/repositories/librarian-links";
import { forbidden, unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readLibrarianOverview, readScopeView } from "@/lib/librarian/server";
import { LibrarianAcceptanceCheck } from "./acceptance-check";
import { LibrarianClient } from "./library-client";
import "./library.css";
export const dynamic = "force-dynamic";
export default async function LibrarianPage({searchParams}: Readonly<{searchParams: Promise<Readonly<{id?: string; plan?: string}>>}>): Promise<ReactElement> {
  const access = await materialOwnerAccess();
  if (access.rejection) { if (access.rejection.status === 401) unauthorized(); forbidden(); }
  const query = await searchParams;
  const parsedPlan = query.plan === undefined ? null : recordId.safeParse(query.plan);
  if (parsedPlan !== null && (!parsedPlan.success || query.id !== undefined)) return <PlanUnavailable />;
  const requestedPlan: string | null = parsedPlan?.success ? parsedPlan.data : null;
  const units = requestedPlan === null ? [] : await listConfirmedUnits(env.DB, access.owner);
  const chosen = requestedPlan === null ? null : units.find((unit): boolean => unit.planVersionId === requestedPlan);
  if (requestedPlan !== null && !chosen) return <PlanUnavailable />;
  const initial = await readLibrarianOverview(access.owner,chosen?.unitId ?? null);
  const selected = query.id ?? (requestedPlan === null ? initial.history[0]?.id : undefined);
  const initialView = selected ? await readScopeView(access.owner,selected) : null;
  const selectedOverview = initialView && initial.unitId !== initialView.scope.unit.unitId && initial.units.some((unit): boolean => unit.unitId === initialView.scope.unit.unitId) ? await readLibrarianOverview(access.owner, initialView.scope.unit.unitId) : initial;
  return <main id="learn-main" tabIndex={-1} className="site-shell"><PageHeader title="오늘의 학습 범위" context="학습 · 오늘의 범위" back={{ href: "/learn/advisor", label: "진단과 계획으로" }} action={null} /><p>확정한 단원에 자료를 연결하고, 원문 근거와 가능한 시간을 확인해 오늘의 범위를 정해요.</p><section id="scope-setup" aria-label="오늘의 범위 설정">{requestedPlan !== null && <p role="status">확정 계획에서 이어왔어요. 사용할 단원·자료·시간을 확인한 뒤 오늘의 범위를 저장해 주세요.</p>}<LibrarianClient key={selected ?? requestedPlan ?? "empty"} initial={selectedOverview} initialView={initialView} /></section><ContextDiagnostics id="diagnostic-library" title="자료 선정"><LibrarianAcceptanceCheck/></ContextDiagnostics></main>;
}

function PlanUnavailable(): ReactElement {
  return <main id="learn-main" tabIndex={-1} className="site-shell"><PageHeader title="확정 계획을 확인해 주세요" context="학습 · 오늘의 범위" back={{ href: "/learn/advisor", label: "진단과 계획으로" }} action={null} /><p role="alert">이 링크의 계획을 현재 소유자의 확정 계획에서 찾을 수 없거나 범위 기록과 함께 지정했어요. 진단과 계획에서 최신 확정본을 열어 다시 이동해 주세요.</p></main>;
}
