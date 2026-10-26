"use client";

import type { ReactElement, RefObject } from "react";
import type { MaterialCard } from "@/lib/materials/library";
import { ImagePreview, TextPreview } from "./original-media";
import { PageExtraction } from "./page-extraction";
import { OriginalDialog } from "./original-dialog";
import { PdfPreview } from "./pdf-preview";

type SourcePreviewProps = Readonly<{ material: MaterialCard; previewRef: RefObject<HTMLElement | null>; onReturnToList: () => void }>;
export function SourcePreview({ material, previewRef, onReturnToList }: SourcePreviewProps): ReactElement {
  return <section ref={previewRef} className="material-preview" aria-label="선택한 자료" tabIndex={-1}><div className="material-preview-heading"><div><p className="eyebrow">원본 보기</p><h2>{material.metadata.title}</h2></div><div className="material-preview-actions"><button type="button" onClick={onReturnToList}>자료 목록으로</button><a href={`${material.file.sourceUrl}?disposition=attachment`} download>원본 다운로드</a></div></div>{material.googleSource&&<p className="source-citation"><a href={material.googleSource.sourceUrl} target="_blank" rel="noreferrer">Google 원본 출처: {material.googleSource.title}</a><br/>가져온 원본의 변경 시각: {new Date(material.googleSource.modifiedTime).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} · 버전 {material.googleSource.driveVersion}<br/>사본 해시: <code style={{overflowWrap:"anywhere"}}>{material.googleSource.sha256}</code></p>}{material.metadata.kind === "pdf" ? <PdfPreview url={material.file.sourceUrl} pages={material.file.pages} title={material.metadata.title} /> : material.metadata.kind === "image" ? <><OriginalDialog label="사진 원본" url={material.file.sourceUrl}><ImagePreview material={material}/></OriginalDialog><ImagePreview material={material} /></> : <TextPreview url={material.file.sourceUrl} />}<PageExtraction key={material.file.objectVersion} material={material} /></section>;
}
