"use client";
/* eslint-disable @next/next/no-img-element -- 비공개 원본에서 만든 제한된 로컬 판독 이미지만 표시합니다. */

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { MaterialCard } from "@/lib/materials/library";
import { z } from "zod";
import { buildSelection, selectionInput } from "@/lib/extraction/selection";
import type { ExtractionJob } from "@/db/repositories/extraction-jobs";
import type { SelectionInput } from "@/lib/extraction/selection";
import { errorText, materialJson } from "./client-api";
import { openPdfDocument } from "./pdf-document";
import { PdfRegionPreparation } from "./pdf-region-preparation";
import { PageVisionControls } from "./page-vision-controls";
import { ExtractionResults } from "./extraction-results";
import { extractPlainText, extractSelectedText } from "./extract-text";
import { preparePdfPageImage, preparePhotoImage } from "./prepare-page-image";
import { pageRotation } from "@/lib/extraction/image";
import type { PageRotation, PreparedPageImage } from "@/lib/extraction/image";
import { storedExtractionPage } from "@/lib/extraction/state";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import type { PageResult } from "@/lib/extraction/result";

const jobReply = z.object({ job: z.object({ jobId: z.string().uuid(), revision: z.number().int().positive(), uploadId: z.string().uuid(), selection: selectionInput }).strict().nullable(), pages: z.array(storedExtractionPage) }).passthrough();

export function PageExtraction({ material }: Readonly<{ material: MaterialCard }>): ReactElement {
  const [failure, setFailure] = useState<string>("");
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [contents, setContents] = useState<string>("");
  const [study, setStudy] = useState<string>("");
  const selectionKey = useRef<string | null>(null);
  const [selection, setSelection] = useState<SelectionInput | null>(null);
  const [prepared, setPrepared] = useState<Readonly<{ filePage: number; image: PreparedPageImage }> | null>(null);
  const [rotation, setRotation] = useState<PageRotation>(0);
  const [pages, setPages] = useState<readonly StoredExtractionPage[]>([]);
  const [busy, setBusy] = useState<boolean>(true);
  const abort = useRef<AbortController | null>(null);
  useEffect((): (() => void) => {
    const stop: AbortController = new AbortController();
    void materialJson(`/api/materials/${material.id}/extraction`, { method: "GET", signal: stop.signal }).then((raw: unknown): void => {
      const snapshot = jobReply.parse(raw); const saved = snapshot.job;
      if (!stop.signal.aborted) { setPages(snapshot.pages); setBusy(false); setJob(saved); setSelection(saved?.selection ?? null); setContents(saved?.selection.pages.filter((page): boolean => page.purpose === "contents").map((page): number => page.filePage).join(", ") ?? ""); setStudy(saved?.selection.pages.filter((page): boolean => page.purpose === "study").map((page): number => page.filePage).join(", ") ?? ""); }
    }).catch((error: unknown): void => { if (!stop.signal.aborted) { setFailure(errorText(error)); setBusy(false); } });
    return (): void => { stop.abort(); abort.current?.abort(); };
  }, [material.id]);
  async function extract(): Promise<void> {
    if (selection === null || job === null) return;
    setBusy(true); setFailure("");
    const stop: AbortController = new AbortController(); abort.current = stop;
    try {
      const handle = await openPdfDocument({ url: material.file.sourceUrl, pages: material.file.pages, signal: stop.signal });
      try {
        const unfinished = job.selection.pages.filter((entry): boolean => pages.some((page): boolean => page.filePage === entry.filePage && ["pending", "failed"].includes(page.state)));
        if (unfinished.length === 0) throw new Error("텍스트를 추출할 미완료 페이지가 없어요. 저장된 결과를 확인해 주세요.");
        await extractSelectedText(handle, { ...job, selection: { ...job.selection, pages: unfinished } }, stop.signal, async (result: PageResult): Promise<void> => {
          const page = pages.find((entry): boolean => entry.filePage === result.filePage);
          if (page === undefined) throw new Error("페이지 저장 상태를 다시 확인해 주세요.");
          const reply = z.object({ page: storedExtractionPage }).passthrough().parse(await materialJson(`/api/materials/${material.id}/extraction/pages/${page.id}/text`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ selectionRevision: job.revision, filePage: result.filePage, expectedVersion: page.version, result }), signal: stop.signal }));
          setPages((previous: readonly StoredExtractionPage[]): readonly StoredExtractionPage[] => previous.map((entry): StoredExtractionPage => entry.id === reply.page.id ? reply.page : entry));
        });
      }
      finally { await handle.close(); }
    } catch (error: unknown) { setFailure(stop.signal.aborted ? "추출을 중단했어요. 완료된 페이지 결과는 아래에서 확인할 수 있어요." : errorText(error)); }
    finally { abort.current = null; setBusy(false); }
  }
  async function prepareImage(filePage: number): Promise<void> {
    if (selection === null || job === null) return;
    setBusy(true); setFailure(""); setPrepared(null);
    const stop: AbortController = new AbortController(); abort.current = stop;
    const binding = job;
    try {
      if (material.file.kind === "image") setPrepared({ filePage, image: await preparePhotoImage(material.file, binding, rotation, stop.signal) });
      else {
        const handle = await openPdfDocument({ url: material.file.sourceUrl, pages: material.file.pages, signal: stop.signal });
        try { setPrepared({ filePage, image: await preparePdfPageImage(handle, binding, filePage, rotation, stop.signal) }); }
        finally { await handle.close(); }
      }
    } catch (error: unknown) { setFailure(errorText(error)); }
    finally { abort.current = null; setBusy(false); }
  }
  async function select(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); setFailure(""); setSelection(null); setPages([]); setPrepared(null);
    setBusy(true);
    try {
      const chosen: SelectionInput = buildSelection(material.file, contents, study);
      selectionKey.current ??= crypto.randomUUID();
      const snapshot = jobReply.parse(await materialJson(`/api/materials/${material.id}/extraction`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": selectionKey.current }, body: JSON.stringify({ selection: chosen, expectedRevision: job?.revision ?? 0 }) }));
      const saved = snapshot.job;
      if (saved === null) throw new Error("저장한 선택 작업을 확인할 수 없어요.");
      setPages(snapshot.pages); setJob(saved); setSelection(saved.selection); selectionKey.current = null;
    } catch (error: unknown) { setFailure(errorText(error)); }
    finally { setBusy(false); }
  }
  async function extractTextFile(): Promise<void> {
    if (!job) return; setBusy(true); setFailure(""); const stop: AbortController = new AbortController(); abort.current = stop;
    try {
      const page = pages.find((item): boolean => item.filePage === 1); if (!page) throw new Error("선택한 텍스트 페이지가 없어요.");
      const result = await extractPlainText(material,job,stop.signal);
      const reply = z.object({ page: storedExtractionPage }).passthrough().parse(await materialJson(`/api/materials/${material.id}/extraction/pages/${page.id}/text`,{ method: "POST",headers: { "content-type": "application/json","idempotency-key": crypto.randomUUID() },body: JSON.stringify({ selectionRevision: job.revision,filePage: 1,expectedVersion: page.version,result }),signal: stop.signal })); savedPage(reply.page);
    } catch (error: unknown) { setFailure(errorText(error)); } finally { abort.current=null; setBusy(false); }
  }
  function savedPage(saved: StoredExtractionPage): void { setPages((previous: readonly StoredExtractionPage[]): readonly StoredExtractionPage[] => previous.map((entry): StoredExtractionPage => entry.id === saved.id ? saved : entry)); }
  async function refresh(): Promise<void> {
    setBusy(true); setFailure(""); setPrepared(null);
    try { const snapshot = jobReply.parse(await materialJson(`/api/materials/${material.id}/extraction`, { method: "GET" })); setPages(snapshot.pages); setJob(snapshot.job); setSelection(snapshot.job?.selection ?? null); setContents(snapshot.job?.selection.pages.filter((page): boolean => page.purpose === "contents").map((page): number => page.filePage).join(", ") ?? ""); setStudy(snapshot.job?.selection.pages.filter((page): boolean => page.purpose === "study").map((page): number => page.filePage).join(", ") ?? ""); }
    catch (error: unknown) { setFailure(errorText(error)); } finally { setBusy(false); }
  }
  const preparedPage: StoredExtractionPage | undefined = pages.find((page): boolean => page.filePage === prepared?.filePage);
  return <section className="extraction-panel" aria-label="선택 페이지 추출"><h3>필요한 페이지만 선택</h3><button type="button" disabled={busy} onClick={(): void => { void refresh(); }}>저장 상태 다시 확인</button><p>파일의 첫 페이지는 1번이에요. 책에 인쇄된 쪽수와 별도로, 한 번에 최대 20페이지를 선택해 주세요.</p><form onSubmit={select} onChange={(): void => { setSelection(null); setFailure(""); setPages([]); setPrepared(null); selectionKey.current = null; }}><fieldset disabled={busy}><label>목차 파일 페이지 <input value={contents} onChange={(event): void => { setContents(event.target.value); }} name="contents" placeholder="예: 1-2" inputMode="text" /></label><label>학습할 파일 페이지 <input value={study} onChange={(event): void => { setStudy(event.target.value); }} name="study" placeholder={material.file.pages === 1 ? "1" : "예: 3, 5-7"} inputMode="text" /></label><button type="submit">선택 범위 확인</button></fieldset></form>{failure && <p role="alert">{failure}</p>}{selection !== null && <div><p role="status">선택한 파일 페이지: {selection.pages.map((page): string => `${page.filePage} (${page.purpose === "contents" ? "목차" : "본문"})`).join(", ")}</p><p>이 범위에 포함된 페이지만 처리합니다.</p>{material.file.kind !== "text" && <div><label>판독 이미지 회전 <select value={rotation} disabled={busy} onChange={(event): void => { setRotation(pageRotation.parse(Number(event.target.value))); setPrepared(null); }}>{[0, 90, 180, 270].map((angle): ReactElement => <option key={angle} value={angle}>{angle}°</option>)}</select></label>{selection.pages.map((page): ReactElement => <button type="button" key={page.filePage} disabled={busy} onClick={(): void => { void prepareImage(page.filePage); }}>파일 {page.filePage}페이지 이미지 준비</button>)}</div>}{material.metadata.kind === "pdf" && job !== null && <PdfRegionPreparation material={material} binding={job} busy={busy} onProcessing={setBusy} onPrepared={setPrepared} onFailure={setFailure} />}{material.metadata.kind === "pdf" && <button type="button" disabled={busy} onClick={(): void => { void extract(); }}>선택 페이지 텍스트 추출</button>}{material.metadata.kind === "text" && <button type="button" disabled={busy} onClick={(): void => { void extractTextFile(); }}>선택 텍스트 추출</button>}{busy && <button type="button" onClick={(): void => { abort.current?.abort(); }}>추출 중단</button>}</div>}{prepared !== null && <figure><img src={prepared.image.dataUrl} alt={`파일 ${prepared.filePage}페이지 판독 이미지`} style={{ maxWidth: "100%" }} /><figcaption>파일 {prepared.filePage}페이지 · {prepared.image.width} × {prepared.image.height}px · {prepared.image.bytes.toLocaleString()}바이트 · {prepared.image.region ? "선택 영역만 포함 · 원본 대조 전" : "전체 페이지 · 원본 대조 전"}</figcaption></figure>}{prepared !== null && preparedPage !== undefined && <PageVisionControls key={`${preparedPage.id}:${preparedPage.version}:${prepared.image.sha256}`} materialId={material.id} page={preparedPage} image={prepared.image} onSaved={savedPage} onProcessing={setBusy} />}<ExtractionResults material={material} pages={pages} onSaved={savedPage} /></section>;
}
