import type { ReactElement } from "react";
import { forbidden, unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readLibrarianOverview, readScopeView } from "@/lib/librarian/server";
import { LibrarianAcceptanceCheck } from "./acceptance-check";
import { LibrarianClient } from "./library-client";
import "./library.css";
export const dynamic = "force-dynamic";
export default async function LibrarianPage({searchParams}: Readonly<{searchParams: Promise<Readonly<{id?: string}>>}>): Promise<ReactElement> {
  const access = await materialOwnerAccess();
  if (access.rejection) { if (access.rejection.status === 401) unauthorized(); forbidden(); }
  const initial = await readLibrarianOverview(access.owner,null);
  const selected = (await searchParams).id ?? initial.history[0]?.id;
  const initialView = selected ? await readScopeView(access.owner,selected) : null;
  return <main className="site-shell"><header className="site-header"><a href="/learn" className="wordmark">ALTER<span>.</span></a><a href="/learn/materials">자료 보관함</a></header><p className="eyebrow">읽을 만큼, 해낼 만큼</p><h1>오늘의 학습 범위</h1><p>확정한 단원에 자료를 연결하고, 원문 근거와 가능한 시간을 확인해 오늘의 범위를 정해요.</p><LibrarianClient key={selected ?? "empty"} initial={initial} initialView={initialView} /><LibrarianAcceptanceCheck /></main>;
}
