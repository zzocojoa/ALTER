"use client";

import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { z } from "zod";
import type { MaterialCard } from "@/lib/materials/library";
import { storedExtractionPage } from "@/lib/extraction/state";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import { ConfirmedSource } from "./confirmed-source";
import { SelectedOriginal } from "./selected-original";
import { errorText, materialJson } from "./client-api";

type EditorProps = Readonly<{ materialId: string; page: StoredExtractionPage; onSaved: (page: StoredExtractionPage) => void }>;
async function savePageAction(url: string, payload: unknown): Promise<StoredExtractionPage> {
  const reply = z.object({ page: storedExtractionPage }).passthrough().parse(await materialJson(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload) }));
  return reply.page;
}
function ResultEditor({ materialId, page, onSaved }: EditorProps): ReactElement {
  const [busy, setBusy] = useState<boolean>(false); const [failure, setFailure] = useState<string>("");
  const base: string = `/api/materials/${materialId}/extraction/pages/${page.id}`;
  const binding = { selectionRevision: page.selectionRevision, filePage: page.filePage, expectedVersion: page.version };
  async function label(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const data: FormData = new FormData(event.currentTarget); setBusy(true); setFailure("");
    try { onSaved(await savePageAction(`${base}/label`, { ...binding, printedPage: String(data.get("printedPage") ?? "").trim() || null })); }
    catch (error: unknown) { setFailure(errorText(error)); } finally { setBusy(false); }
  }
  async function confirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const data: FormData = new FormData(event.currentTarget); setBusy(true); setFailure("");
    try {
      const segmentIds: string[] = data.getAll("segment").map(String);
      if (segmentIds.length === 0) throw new Error("원본과 대조한 구간을 하나 이상 선택해 주세요.");
      onSaved(await savePageAction(`${base}/confirm`, { ...binding, resultId: page.resultId, segmentIds, printedPage: page.printedPage, comparedWithOriginal: data.get("compared") === "on" }));
    } catch (error: unknown) { setFailure(errorText(error)); } finally { setBusy(false); }
  }
  async function edit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const data: FormData = new FormData(event.currentTarget); setBusy(true); setFailure("");
    try { onSaved(await savePageAction(`${base}/edit`, { ...binding, resultId: page.resultId, segments: (page.result?.segments.length === 0 ? [{ id: "s0" }] : page.result?.segments ?? []).map((segment) => ({ id: segment.id, text: String(data.get(segment.id) ?? "") })) })); }
    catch (error: unknown) { setFailure(errorText(error)); } finally { setBusy(false); }
  }
  async function recover(): Promise<void> {
    setBusy(true); setFailure("");
    try { onSaved(await savePageAction(`${base}/recover`, { selectionRevision: page.selectionRevision, filePage: page.filePage })); }
    catch (error: unknown) { setFailure(errorText(error)); } finally { setBusy(false); }
  }
  const result = page.result;
  return <article aria-label={`파일 ${page.filePage}페이지 추출 결과`}>
    <h4>파일 {page.filePage}페이지 · 결과 {page.resultVersion}판</h4>{page.resultImage?.region && <p>영역 판독 결과 · 원본 왼쪽 {Math.round(page.resultImage.region.x*1000)/10}%, 위쪽 {Math.round(page.resultImage.region.y*1000)/10}%, 너비 {Math.round(page.resultImage.region.width*1000)/10}%, 높이 {Math.round(page.resultImage.region.height*1000)/10}%. 영역 밖은 판독하지 않았어요.</p>}
    <form onSubmit={label}><fieldset disabled={busy}><label>인쇄된 쪽수 <input name="printedPage" defaultValue={page.printedPage ?? ""} maxLength={40} placeholder="예: iii, 12 또는 빈칸" /></label><button type="submit">쪽수 저장</button></fieldset></form>
    <p className="material-note">파일 번호는 고정돼요. 인쇄된 쪽수는 표지·로마 숫자·누락 쪽수를 표시하는 별도 정보예요.</p>
    {failure && <p role="alert">{failure}</p>}
    {page.state === "unknown" || page.state === "running" ? <p role="status">AI 처리 결과 확인이 필요해요. 기존 요청을 확인하며 자동으로 다시 생성하지 않습니다. <button type="button" disabled={busy} onClick={(): void => { void recover(); }}>기존 AI 요청 결과 확인</button></p> : page.failure && <p role="alert">{page.failure}</p>}
    {result === null ? <p>아직 저장된 추출 결과가 없어요.</p> : <>
      {result.status === "blank" && <p>빈 페이지예요.</p>}{result.status === "no-text" && <p>추출된 텍스트가 없어요. 원본을 확인한 뒤 비전 판독이나 직접 전사를 선택해 주세요.</p>}{result.status === "unreadable" && <p>판독할 수 없는 페이지예요. 원본을 다시 확인해 주세요.</p>}
      <form onSubmit={confirm}><fieldset disabled={busy || page.state !== "complete" || result.status !== "complete"}>
        {result.segments.map((segment, index): ReactElement => <section key={segment.id} className="extraction-segment" aria-label={`구간 ${index + 1}`}>
          <p><strong>{segment.kind === "formula" ? "수식" : segment.kind === "table" ? "표" : segment.kind === "unreadable" ? "판독 불가" : "텍스트"}</strong> · {page.confirmedSegmentIds.includes(segment.id) ? "확인됨" : "미확인"}</p>
          <pre className="material-text">{segment.text || "읽을 수 있는 내용이 없어요."}</pre>
          {segment.uncertain && <p className="extraction-uncertain">확인 필요: {segment.reason}</p>}
          {page.confirmedSegmentIds.includes(segment.id) ? <div><p>이 버전의 구간을 원본과 대조했어요.</p><ConfirmedSource materialId={materialId} page={page} segmentId={segment.id} /></div> : <label><input type="checkbox" name="segment" value={segment.id} disabled={segment.kind === "unreadable" || !segment.text.trim()} /> 구간 {index + 1} 확인</label>}
        </section>)}
        <label><input type="checkbox" name="compared" required /> 선택한 구간을 이 파일 페이지의 원본과 대조했어요.</label><button type="submit">선택 구간 확인 저장</button>
      </fieldset></form>
      <details><summary>추출 내용 수정</summary><p>수정본을 저장하면 모든 구간이 다시 미확인 상태가 됩니다.</p><form onSubmit={edit}><fieldset disabled={busy || page.state !== "complete"}>
        {(result.segments.length === 0 ? [{ id: "s0", text: "" }] : result.segments).map((segment, index): ReactElement => <label key={segment.id}>구간 {index + 1} 수정 <textarea name={segment.id} defaultValue={segment.text} maxLength={60000} rows={5} /></label>)}
        <button type="submit">수정본 저장</button>
      </fieldset></form></details>
    </>}
  </article>;
}

export function ExtractionResults({ material, pages, onSaved }: Readonly<{ material: MaterialCard; pages: readonly StoredExtractionPage[]; onSaved: (page: StoredExtractionPage) => void }>): ReactElement | null {
  const [selectedId, setSelectedId] = useState<string | null>(null); const [pane, setPane] = useState<"source" | "result">("result");
  const page: StoredExtractionPage | undefined = pages.find((item): boolean => item.id === selectedId) ?? pages[0];
  if (page === undefined) return null;
  return <section className="extraction-review" aria-label="원본과 결과 비교">
    <h3>원본과 나란히 확인</h3><nav className="material-toolbar" aria-label="비교할 파일 페이지">{pages.map((item): ReactElement => <button type="button" key={item.id} aria-pressed={page.id === item.id} onClick={(): void => { setSelectedId(item.id); }}>파일 {item.filePage}페이지 결과{item.state === "failed" ? " · 실패" : item.state === "pending" ? " · 대기" : item.state === "unknown" ? " · 확인 필요" : ""}</button>)}</nav>
    <div className="extraction-pane-switch"><button type="button" aria-pressed={pane === "source"} onClick={(): void => { setPane("source"); }}>원본 보기</button><button type="button" aria-pressed={pane === "result"} onClick={(): void => { setPane("result"); }}>추출 결과 보기</button></div>
    <div className="extraction-comparison"><div className={`extraction-original ${pane === "source" ? "mobile-visible" : "mobile-hidden"}`}><SelectedOriginal material={material} filePage={page.filePage} /></div><div className={pane === "result" ? "mobile-visible" : "mobile-hidden"}><ResultEditor key={`${page.id}:${page.version}`} materialId={material.id} page={page} onSaved={onSaved} /></div></div>
  </section>;
}
