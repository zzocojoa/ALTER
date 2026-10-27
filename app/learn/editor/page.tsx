import { ContextDiagnostics } from "../diagnostics/context-diagnostics";
import { PageHeader } from "@/components/alter/page-header";
import { EditorAcceptanceCheck } from "./acceptance-check";
import type { ReactElement } from "react";
import { forbidden,unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readEditorOverview,readEditorView } from "@/lib/editor/server";
import { EditorClient } from "./editor-client";
import "../tutor/tutor.css";
import "./editor.css";
export const dynamic="force-dynamic";
export default async function EditorPage({searchParams}:Readonly<{searchParams:Promise<Readonly<{id?:string}>>}>):Promise<ReactElement> {
  const access=await materialOwnerAccess();if(access.rejection){if(access.rejection.status===401) unauthorized();forbidden();}
  const overview=await readEditorOverview(access.owner);const selected=(await searchParams).id ?? overview.history[0]?.id;const view=selected ? await readEditorView(access.owner,selected) : null;
  return <main id="learn-main" tabIndex={-1} className="site-shell"><PageHeader title="결과물 개선" context="학습 · 내 글 고치기" back={{ href: "/learn/tutor", label: "수업으로" }} action={null} /><p>핵심 피드백을 읽고 직접 고쳐 보세요. 새 조건에서 푸는 답안은 별도로 확인해요.</p><p><a href="/learn/results">저장한 수업 결과 확인·확정</a></p><EditorClient initial={overview} initialView={view}/><ContextDiagnostics id="diagnostic-editor" title="초안과 첨삭"><EditorAcceptanceCheck/></ContextDiagnostics></main>;
}
