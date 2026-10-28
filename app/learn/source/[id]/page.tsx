import { PageHeader } from "@/components/alter/page-header";
import type { ReactElement } from "react";
import { env } from "cloudflare:workers";
import { forbidden, unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { recordId } from "@/lib/domain/contracts";
import { resolveExtractionSource } from "@/lib/extraction/source-server";
import { sourceRecheckAction } from "@/lib/librarian/issues";
import { getRegisteredMaterial } from "@/lib/materials/download";
import { materialFileReference } from "@/lib/materials/attachment";
import { recordMaterialExposure } from "@/db/repositories/material-access";
import { SourceAccess } from "../../materials/source-access";
import { SelectedOriginal } from "../../materials/selected-original";

export const dynamic = "force-dynamic";
export default async function SourcePage({ params }: Readonly<{ params: Promise<{ id: string }> }>): Promise<ReactElement> {
  const access = await materialOwnerAccess();
  if (access.rejection) { if (access.rejection.status === 401) unauthorized(); forbidden(); }
  const id: string = recordId.parse((await params).id);
  const judgment = await resolveExtractionSource(env.DB, env.BUCKET, access.owner, id);
  if (!judgment.valid) return <main id="learn-main" tabIndex={-1} className="site-shell"><h1>구간 확인이 필요해요</h1><p>{sourceRecheckAction(judgment.reason)}</p><a href="/learn/library">학습 범위로 돌아가기</a></main>;
  const transfer = await getRegisteredMaterial(env.DB, access.owner, judgment.source.materialId); await recordMaterialExposure(env.DB, access.owner, transfer);
  const material = { id: transfer.materialId,courseId: transfer.courseId,metadata: transfer.metadata,file: materialFileReference(transfer) };
  const chars: string[] = Array.from(judgment.page.content);
  return <main id="learn-main" tabIndex={-1} className="site-shell material-page"><PageHeader title={material.metadata.title} context="자료 · 원본과 추출 결과" back={{ href: "/learn/library", label: "학습 범위로" }} action={null} /><p>판본 {material.metadata.edition || "미입력"} · 파일 {judgment.source.filePage}페이지 · 인쇄 쪽수 {judgment.source.printedPage ?? "미확인"}</p><SourceAccess sourceId={id}><h2>선택한 정확한 구간</h2><p>아래 인용은 사용자가 원본과 대조한 본문이에요. 위 등록 제목·판본이나 별도로 확인한 외부 서지정보와 구분합니다.</p><p>문자 위치 {judgment.source.spanStart} ~ {judgment.source.spanEnd} · 유니코드 문자 기준</p><blockquote style={{ whiteSpace: "pre-wrap",overflowWrap: "anywhere" }}>{judgment.source.evidence}</blockquote><details><summary>전체 추출 결과에서 위치 확인</summary><pre style={{ whiteSpace: "pre-wrap",overflowWrap: "anywhere" }}>{chars.slice(0,judgment.source.spanStart).join("")}<mark>{chars.slice(judgment.source.spanStart,judgment.source.spanEnd).join("")}</mark>{chars.slice(judgment.source.spanEnd).join("")}</pre></details><SelectedOriginal material={material} filePage={judgment.source.filePage} printedPage={judgment.source.printedPage} highlight={null} /></SourceAccess></main>;
}
