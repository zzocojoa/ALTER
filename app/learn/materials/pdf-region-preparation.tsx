"use client";
import { useEffect, useRef } from "react";
import type { FormEvent, ReactElement } from "react";
import { pdfRegion } from "@/lib/extraction/image";
import type { PreparedPageImage } from "@/lib/extraction/image";
import type { SelectionBinding } from "@/lib/extraction/selection";
import type { MaterialCard } from "@/lib/materials/library";
import { openPdfDocument } from "./pdf-document";
import { preparePdfRegionImage } from "./prepare-page-image";
import { errorText } from "./client-api";

type Props = Readonly<{ material: MaterialCard; binding: SelectionBinding; busy: boolean; onProcessing: (busy: boolean) => void; onPrepared: (value: Readonly<{filePage: number; image: PreparedPageImage}>) => void; onFailure: (message: string) => void }>;
export function PdfRegionPreparation({material,binding,busy,onProcessing,onPrepared,onFailure}: Props): ReactElement {
  const abort = useRef<AbortController | null>(null);
  useEffect(() => (): void => { abort.current?.abort(); }, []);
  async function prepare(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (abort.current !== null || busy) return; const data = new FormData(event.currentTarget); const stop = new AbortController(); abort.current = stop; onProcessing(true); onFailure("");
    try {
      const region = pdfRegion.parse({x:Number(data.get("x"))/100,y:Number(data.get("y"))/100,width:Number(data.get("width"))/100,height:Number(data.get("height"))/100});
      const filePage = Number(data.get("page"));
      const handle = await openPdfDocument({url:material.file.sourceUrl,pages:material.file.pages,signal:stop.signal});
      try { const image = await preparePdfRegionImage(handle,binding,filePage,region,0,stop.signal); stop.signal.throwIfAborted(); onPrepared({filePage,image}); }
      finally { await handle.close(); }
    } catch(error:unknown) { onFailure(errorText(error)); }
    finally { abort.current=null;onProcessing(false); }
  }
  return <details><summary>작은 글씨 · PDF 영역 확대 판독</summary><p>원본의 왼쪽 위를 기준으로 영역을 정해요. 여백을 제외하면 같은 용량 안에서 글씨를 크게 보낼 수 있어요. 선택 영역만 새 결과로 저장되므로 필요한 본문이 모두 들어왔는지 준비 이미지를 확인하세요. 입력만으로 AI를 호출하지 않아요.</p><form onSubmit={prepare}><fieldset disabled={busy}><label>확대할 파일 페이지<select name="page">{binding.selection.pages.map(page=><option key={page.filePage} value={page.filePage}>{page.filePage}</option>)}</select></label>{([['x','왼쪽 위치 (%)',0],['y','위쪽 위치 (%)',0],['width','영역 너비 (%)',100],['height','영역 높이 (%)',100]] as const).map(([name,label,value])=><label key={name}>{label}<input name={name} type="number" min={name==='width'||name==='height'?0.1:0} max={100} step={0.1} defaultValue={value} required /></label>)}<button type="submit">선택 영역 이미지 준비</button></fieldset></form>{busy && <button type="button" onClick={():void=>abort.current?.abort()}>영역 준비 중단</button>}</details>;
}
