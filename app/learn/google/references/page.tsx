import { env } from "cloudflare:workers";
import type { ReactElement } from "react";
import { forbidden,unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { listGoogleReferences } from "@/db/repositories/google-references";
import { readMaterialLibrary } from "@/lib/materials/library";
import { GoogleReferencesClient } from "./references-client";
export const dynamic="force-dynamic";
export default async function GoogleReferencesPage():Promise<ReactElement> {
  const access=await materialOwnerAccess();if(access.rejection){if(access.rejection.status===401)unauthorized();forbidden();}
  const [references,library]=await Promise.all([listGoogleReferences(env.DB,access.owner),readMaterialLibrary(env.DB,access.owner,null)]);
  return <main className="site-shell"><header className="site-header"><a className="wordmark" href="/learn">ALTER<span>.</span></a><a href="/learn/google">Google 연결</a></header><p className="eyebrow">선택한 원본의 사본</p><h1>Google 참고 자료 가져오기</h1><p>Google에서 직접 선택한 Docs·PDF·JPG·PNG만 가져올 수 있어요. Docs는 탭·문단·표의 텍스트를 가져오며, 이미지·수식 등 지원하지 않는 내용이 있으면 등록을 멈춰요.</p>{library.hidden?<p>자료를 가리고 답하는 중이에요. 답안을 제출한 뒤 가져올 수 있어요.</p>:<GoogleReferencesClient files={references.files} courses={library.courses}/>}{references.hasMore&&<p>최근 선택한 100개를 표시해요. 필요한 파일을 Google 연결에서 다시 선택해 주세요.</p>}<p>원본 ID·제목·변경 시각과 사본의 해시를 함께 보관해요. Google 원본은 바꾸지 않아요. 등록 후 자료 보관함에서 페이지를 선택해 판독할 수 있어요. 새 AI 판독은 별도의 승인·예산 기준을 적용해요.</p><a href="/learn/materials">자료 보관함</a></main>;
}
