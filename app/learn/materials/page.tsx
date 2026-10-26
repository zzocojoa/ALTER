import { recordId } from "@/lib/domain/contracts";
import type { ReactElement } from "react";
import { env } from "cloudflare:workers";
import { forbidden, unauthorized, notFound } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readMaterialLibrary } from "@/lib/materials/library";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { MaterialLibraryClient } from "./library-client";

export const dynamic = "force-dynamic";
export default async function MaterialsPage({ searchParams }: Readonly<{ searchParams: Promise<Readonly<{ open?: string }>> }>): Promise<ReactElement> {
  const access = await materialOwnerAccess();
  if (access.rejection !== null) {
    if (access.rejection.status === 401) unauthorized();
    if (access.rejection.status === 403) forbidden();
    return <main className="site-shell"><h1>자료 보관함을 준비하고 있어요</h1><p>소유자 설정을 확인한 뒤 다시 접속해 주세요.</p></main>;
  }
  const { DB } = requireStorageBindings(env);
  const initial = await readMaterialLibrary(DB, access.owner, null);
  const query = await searchParams;
  const selection = query.open === undefined ? null : recordId.safeParse(query.open);
  if (selection !== null && !selection.success) notFound();
  const initialSelectedId = selection?.success ? selection.data : null;
  return <main className="site-shell material-page"><header className="site-header"><a href="/learn" className="wordmark">ALTER<span>.</span></a><a href="/learn">학습 공간으로</a></header><div className="material-page-heading"><p className="eyebrow">나만의 학습 서가</p><h1>자료 보관함</h1></div><MaterialLibraryClient initial={initial} initialSelectedId={initialSelectedId} /></main>;
}
