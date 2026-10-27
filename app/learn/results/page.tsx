import { readResultHistory } from "@/db/repositories/result-history";
import type { ResultHistoryItem } from "@/lib/results/history";
import { PageHeader } from "@/components/alter/page-header";
import type { ResultDraft } from "@/lib/results/contracts";
import type { ReactElement } from "react";
import { forbidden,unauthorized } from "next/navigation";
import { env } from "cloudflare:workers";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readResultSnapshot } from "@/db/repositories/result-draft";
import { isDomainFailure } from "@/db/repositories/atomic";
import { ResultClient } from "./result-client";
import "./results.css";
export const dynamic="force-dynamic";
export default async function ResultsPage({searchParams}:Readonly<{searchParams:Promise<Readonly<{id?:string}>>}>):Promise<ReactElement> {
  const access=await materialOwnerAccess();if(access.rejection){if(access.rejection.status===401) unauthorized();forbidden();}
  const query=await searchParams;
  let history: readonly ResultHistoryItem[] = []; let draft: ResultDraft | null = null; let issue: string | null = null;
  try {
    history = await readResultHistory(env.DB, access.owner);
    const id: string | undefined = query.id ?? history[0]?.id;
    draft = id ? (await readResultSnapshot(env.DB, access.owner, id)).draft : null;
  } catch (error: unknown) {
    if (!isDomainFailure(error)) throw error;
    issue = error.code === "reference_conflict" ? "현재 수업의 인출 답안을 먼저 저장하거나 수업을 마친 뒤 결과를 확인해 주세요." : "서버 기록을 확인하지 못했어요. 새로고침 후 다시 확인하세요.";
  }
  return <main id="learn-main" tabIndex={-1} className="site-shell"><PageHeader title="수업 결과 확인" context="기록 · 근거 확인과 확정" back={{ href: "/learn", label: "오늘로" }} action={null} /><p>확정된 수업 기록을 찾아 열고, 미확정 회차의 결과도 확인할 수 있어요.</p>{issue ? <p role="alert">{issue}</p> : draft ? <ResultClient initial={draft} history={history}/> : <p>먼저 수업에서 답안을 제출해 주세요.</p>}</main>;
}
