"use client";
/* eslint-disable @next/next/no-img-element -- 비공개 원본에서 만든 제한된 로컬 판독 이미지만 표시합니다. */

import { useCallback, useEffect, useRef, useState } from "react";
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
import { resultTarget as targetForPage, matchesResultTarget, transcriptionTarget } from "./result-navigation";
import type { ResultTarget } from "./result-navigation";
import { mergePageSnapshot, requirePageResponse } from "./page-response";
import { useTextExtractionSave } from "./use-text-extraction-save";
import { usePdfPageAnalysis } from "./use-pdf-page-analysis";
import { canExtractPdfText, pageExtractionAction } from "./page-extraction-action";
import type { ComparisonPane } from "./original-comparison";
import { ExtractionProgress } from "./extraction-progress";
import { extractPlainText, extractSelectedText } from "./extract-text";
import { preparePdfPageImage, preparePhotoImage } from "./prepare-page-image";
import { transcriptionEntry } from "@/lib/extraction/transcription";
import { pageRotation } from "@/lib/extraction/image";
import type { PageRotation, PreparedPageImage } from "@/lib/extraction/image";
import { storedExtractionPage } from "@/lib/extraction/state";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import type { OriginalPageLabel } from "./original-toolbar";
import type { PageResult } from "@/lib/extraction/result";

const jobReply = z.object({ job: z.object({ jobId: z.string().uuid(), revision: z.number().int().positive(), uploadId: z.string().uuid(), selection: selectionInput }).strict().nullable(), pages: z.array(storedExtractionPage) }).passthrough();

export function PageExtraction({ material, onPageLabels }: Readonly<{ material: MaterialCard; onPageLabels: (labels: readonly OriginalPageLabel[]) => void }>): ReactElement {
  const [failure, setFailure] = useState<string>("");
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const [contents, setContents] = useState<string>("");
  const [study, setStudy] = useState<string>("");
  const selectionKey = useRef<string | null>(null);
  const [selection, setSelection] = useState<SelectionInput | null>(null);
  const [prepared, setPrepared] = useState<Readonly<{ filePage: number; image: PreparedPageImage }> | null>(null);
  const [rotation, setRotation] = useState<PageRotation>(0);
  const [pages, setPages] = useState<readonly StoredExtractionPage[]>([]);
  const currentPages = useRef<readonly StoredExtractionPage[]>([]);
  const active = useRef<boolean>(true);
  const setCurrentPages = useCallback((next: readonly StoredExtractionPage[]): void => { currentPages.current = next; setPages(next); }, []);
  const textSave = useTextExtractionSave(material.id, savedPage);
  const actionsHeading = useRef<HTMLHeadingElement>(null);
  const [savedNotice, setSavedNotice] = useState<ResultTarget | null>(null);
  const [resultTarget, setResultTarget] = useState<ResultTarget | null>(null);
  const [resultFocus, setResultFocus] = useState<number>(0);
  const analysis = usePdfPageAnalysis(material, selection === null ? null : job);
  const [busy, setBusy] = useState<boolean>(true);
  const abort = useRef<AbortController | null>(null);
  useEffect((): void => { onPageLabels(pages.map((page): OriginalPageLabel => ({ filePage: page.filePage, printedPage: page.printedPage }))); }, [pages, onPageLabels]);
  useEffect((): (() => void) => {
    active.current = true;
    const stop: AbortController = new AbortController();
    void materialJson(`/api/materials/${material.id}/extraction`, { method: "GET", signal: stop.signal }).then((raw: unknown): void => {
      const snapshot = jobReply.parse(raw); const saved = snapshot.job;
      if (!stop.signal.aborted) { setCurrentPages(snapshot.pages); setBusy(false); setJob(saved); setSelection(saved?.selection ?? null); setContents(saved?.selection.pages.filter((page): boolean => page.purpose === "contents").map((page): number => page.filePage).join(", ") ?? ""); setStudy(saved?.selection.pages.filter((page): boolean => page.purpose === "study").map((page): number => page.filePage).join(", ") ?? ""); }
    }).catch((error: unknown): void => { if (!stop.signal.aborted) { setFailure(errorText(error)); setBusy(false); } });
    return (): void => { active.current = false; currentPages.current = []; stop.abort(); abort.current?.abort(); };
  }, [material.id, setCurrentPages]);
  async function extract(targets: readonly StoredExtractionPage[]): Promise<void> {
    if (selection === null || job === null || abort.current !== null) return;
    setBusy(true); setFailure("");
    const stop: AbortController = new AbortController(); abort.current = stop;
    try {
      const handle = await openPdfDocument({ url: material.file.sourceUrl, pages: material.file.pages, signal: stop.signal });
      try {
        const unfinished = job.selection.pages.filter((entry): boolean => targets.some((page): boolean => page.filePage === entry.filePage && !textSave.blocks(page) && canExtractPdfText(page, analysis.pages.find((item): boolean => item.filePage === page.filePage) ?? null)));
        if (unfinished.length === 0) throw new Error("텍스트를 추출할 미완료 페이지가 없어요. 저장된 결과를 확인해 주세요.");
        await extractSelectedText(handle, { ...job, selection: { ...job.selection, pages: unfinished } }, stop.signal, async (result: PageResult): Promise<void> => {
          const page = currentPages.current.find((entry): boolean => entry.filePage === result.filePage);
          if (page === undefined || page.jobId !== job.jobId || page.selectionRevision !== job.revision || !canExtractPdfText(page, analysis.pages.find((item): boolean => item.filePage === page.filePage) ?? null)) throw new Error("페이지 저장 상태를 다시 확인해 주세요.");
          await textSave.save(page, result, stop.signal);
        });
      }
      finally { await handle.close(); }
    } catch (error: unknown) { setFailure(stop.signal.aborted ? "추출을 중단했어요. 완료된 페이지 결과는 아래에서 확인할 수 있어요." : errorText(error)); }
    finally { abort.current = null; setBusy(false); }
  }
  async function prepareImage(filePage: number): Promise<void> {
    if (selection === null || job === null || abort.current !== null) return;
    setBusy(true); setFailure(""); setPrepared(null);
    const stop: AbortController = new AbortController(); abort.current = stop;
    const binding = job;
    try {
      if (material.file.kind === "image") { const image = await preparePhotoImage(material.file, binding, rotation, stop.signal); stop.signal.throwIfAborted(); setPrepared({ filePage, image }); }
      else {
        const handle = await openPdfDocument({ url: material.file.sourceUrl, pages: material.file.pages, signal: stop.signal });
        try { const image = await preparePdfPageImage(handle, binding, filePage, rotation, stop.signal); stop.signal.throwIfAborted(); setPrepared({ filePage, image }); }
        finally { await handle.close(); }
      }
    } catch (error: unknown) { setFailure(errorText(error)); }
    finally { abort.current = null; setBusy(false); }
  }
  async function select(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (abort.current !== null || busy) return; setFailure(""); setSelection(null); setCurrentPages([]); setPrepared(null);
    setBusy(true); const stop: AbortController = new AbortController(); abort.current = stop;
    try {
      const chosen: SelectionInput = buildSelection(material.file, contents, study);
      selectionKey.current ??= crypto.randomUUID();
      const snapshot = jobReply.parse(await materialJson(`/api/materials/${material.id}/extraction`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": selectionKey.current }, body: JSON.stringify({ selection: chosen, expectedRevision: job?.revision ?? 0 }), signal: stop.signal }));
      stop.signal.throwIfAborted();
      const saved = snapshot.job;
      if (saved === null) throw new Error("저장한 선택 작업을 확인할 수 없어요.");
      setCurrentPages(snapshot.pages); setJob(saved); setSelection(saved.selection); selectionKey.current = null;
    } catch (error: unknown) { setFailure(errorText(error)); }
    finally { abort.current = null; setBusy(false); }
  }
  async function extractTextFile(): Promise<void> {
    if (!job || abort.current !== null) return; setBusy(true); setFailure(""); const stop: AbortController = new AbortController(); abort.current = stop;
    try {
      const page = currentPages.current.find((item): boolean => item.filePage === 1); if (!page) throw new Error("선택한 텍스트 페이지가 없어요.");
      if (textSave.blocks(page) || !["pending", "failed"].includes(page.state) || (page.result !== null && page.result.status !== "failed")) throw new Error("저장된 결과를 먼저 확인해 주세요.");
      const result = await extractPlainText(material,job,stop.signal);
      await textSave.save(page, result, stop.signal);
    } catch (error: unknown) { setFailure(errorText(error)); } finally { abort.current=null; setBusy(false); }
  }
  function savedPage(saved: StoredExtractionPage): void {
    const expected: StoredExtractionPage | undefined = currentPages.current.find((page): boolean => page.id === saved.id);
    if (!active.current || expected === undefined) throw new Error("저장 응답의 선택 범위·파일 페이지·기록 판이 달라요. 저장 상태를 다시 확인해 주세요.");
    requirePageResponse(saved, expected);
    setCurrentPages(currentPages.current.map((entry): StoredExtractionPage => entry.id === saved.id ? saved : entry));
    if (saved.state === "complete" && saved.result?.status === "complete" && saved.resultId !== expected.resultId) setSavedNotice(targetForPage(saved, "result"));
  }
  async function refresh(): Promise<void> {
    if (abort.current !== null) return;
    const stop: AbortController = new AbortController(); abort.current = stop;
    setBusy(true); setFailure(""); setPrepared(null);
    try { const snapshot = jobReply.parse(await materialJson(`/api/materials/${material.id}/extraction`, { method: "GET", signal: stop.signal })); stop.signal.throwIfAborted(); if (job !== null && (snapshot.job === null || snapshot.job.revision < job.revision)) throw new Error("조회한 선택 범위가 현재보다 오래됐어요. 다시 확인해 주세요."); setCurrentPages(mergePageSnapshot(currentPages.current, snapshot.pages)); setJob(snapshot.job); setSelection(snapshot.job?.selection ?? null); setContents(snapshot.job?.selection.pages.filter((page): boolean => page.purpose === "contents").map((page): number => page.filePage).join(", ") ?? ""); setStudy(snapshot.job?.selection.pages.filter((page): boolean => page.purpose === "study").map((page): number => page.filePage).join(", ") ?? ""); }
    catch (error: unknown) { setFailure(errorText(error)); } finally { abort.current = null; setBusy(false); }
  }
  function viewPage(pageId: string, pane: ComparisonPane): void {
    const page: StoredExtractionPage | undefined = pages.find((entry): boolean => entry.id === pageId);
    if (page === undefined) throw new Error("이동할 파일 페이지를 현재 선택 범위에서 찾을 수 없어요.");
    setResultTarget(targetForPage(page, pane)); setResultFocus((previous: number): number => previous + 1);
  }
  function startTranscription(page: StoredExtractionPage): void {
    if (!["create", "edit"].includes(transcriptionEntry(page))) { viewPage(page.id, "result"); return; }
    setResultTarget(transcriptionTarget(page)); setResultFocus((previous: number): number => previous + 1);
  }
  function returnToActions(): void { actionsHeading.current?.focus({ preventScroll: true }); actionsHeading.current?.scrollIntoView({ behavior: "instant", block: "start" }); }
  const noticePage: StoredExtractionPage | undefined = savedNotice === null ? undefined : pages.find((page): boolean => matchesResultTarget(page, savedNotice));
  const textPages: readonly StoredExtractionPage[] = pages.filter((page): boolean => !textSave.blocks(page) && canExtractPdfText(page, analysis.pages.find((item): boolean => item.filePage === page.filePage) ?? null));
  const preparedPage: StoredExtractionPage | undefined = pages.find((page): boolean => page.filePage === prepared?.filePage);
  return <section className="extraction-panel" aria-label="선택 페이지 추출"><h3 ref={actionsHeading} tabIndex={-1}>필요한 페이지만 선택</h3>
    <ExtractionProgress selection={selection} pages={pages} busy={busy} />
    <button type="button" disabled={busy} onClick={(): void => { void refresh(); }}>저장 상태 다시 확인</button>
    <p>파일의 첫 페이지는 1번이에요. 책에 인쇄된 쪽수와 별도로, 한 번에 최대 20페이지를 선택해 주세요.</p>
    <form onSubmit={select} onChange={(): void => { setSelection(null); setFailure(""); setCurrentPages([]); setPrepared(null); selectionKey.current = null; }}><fieldset disabled={busy}>
      <label>목차 파일 페이지 <input value={contents} onChange={(event): void => { setContents(event.target.value); }} name="contents" placeholder="예: 1-2" inputMode="text" /></label>
      <label>학습할 파일 페이지 <input value={study} onChange={(event): void => { setStudy(event.target.value); }} name="study" placeholder={material.file.pages === 1 ? "1" : "예: 3, 5-7"} inputMode="text" /></label><button type="submit">선택 범위 확인</button>
    </fieldset></form>
    {failure && <p role="alert">{failure}</p>}
    {textSave.issues.filter((issue): boolean => pages.some((page): boolean => page.id === issue.attempt.pageId && page.selectionRevision === issue.attempt.selectionRevision)).map((issue): ReactElement => <div key={issue.attempt.requestKey} aria-label={`파일 ${issue.attempt.filePage}페이지 텍스트 저장 확인`}>
      <p role={issue.state === "saving" ? "status" : "alert"}>파일 {issue.attempt.filePage}페이지 · {issue.message}</p>
      {issue.state !== "saving" && <button type="button" disabled={textSave.reading || busy} onClick={(): void => { void textSave.read(issue.attempt); }}>파일 {issue.attempt.filePage}페이지 텍스트 저장 결과 다시 읽기</button>}
      {issue.state === "checked" && <button type="button" onClick={(): void => textSave.continueAfterRead(issue.attempt)}>재조회한 결과를 대조하고 다음 행동 선택</button>}
    </div>)}
    {selection !== null && <div>
      <p role="status">선택한 파일 페이지: {selection.pages.map((page): string => `${page.filePage} (${page.purpose === "contents" ? "목차" : "본문"})`).join(", ")}</p>
      <p className="alter-caption">페이지 분석·텍스트 추출·이미지 준비는 무료예요. ‘이 페이지 AI 판독’을 실행할 때만 선택 이미지 한 장을 OpenAI로 전송해요.</p>
      {material.file.kind !== "text" && <label>판독 이미지 회전 <select value={rotation} disabled={busy} onChange={(event): void => { setRotation(pageRotation.parse(Number(event.target.value))); setPrepared(null); }}>{[0, 90, 180, 270].map((angle): ReactElement => <option key={angle} value={angle}>{angle}°</option>)}</select></label>}
      {material.file.kind === "pdf" && <>
        <p role="status">{analysis.analyzing ? "선택한 페이지만 차례로 분석하고 있어요…" : "페이지별 다음 행동을 확인해 주세요."}</p>
        {analysis.failure !== null && <p role="alert">페이지 분석 실패: {analysis.failure} 아래에서 해당 페이지 분석을 다시 시도해 주세요.</p>}
        <ol className="alter-extraction-actions">{pages.map((page): ReactElement => {
          const inspected = analysis.pages.find((item): boolean => item.filePage === page.filePage) ?? null;
          const action = pageExtractionAction(page, inspected);
          const blocked: boolean = busy || textSave.blocks(page) || (["analyze", "retry"].includes(action.kind) && analysis.analyzing);
          function act(): void {
            if (action.kind === "extract") { void extract([page]); return; }
            if (action.kind === "prepare") { void prepareImage(page.filePage); return; }
            if (action.kind === "retry" || action.kind === "analyze") { analysis.retry(page.filePage); return; }
            viewPage(page.id, action.kind === "original" ? "source" : "result");
          }
          return <li key={page.id} aria-label={`파일 ${page.filePage}페이지 다음 행동`}>
            <h4>파일 {page.filePage}페이지{page.printedPage === null ? "" : ` · 인쇄 ${page.printedPage}쪽`}</h4><p>{action.description}</p>
            <div className="material-toolbar"><button type="button" disabled={blocked} onClick={act}>{action.label}</button>
              {action.kind !== "original" && <button type="button" onClick={(): void => viewPage(page.id, "source")}>파일 {page.filePage}페이지 원본 확인</button>}
              {["extract", "original"].includes(action.kind) && <button type="button" disabled={busy} onClick={(): void => { void prepareImage(page.filePage); }}>파일 {page.filePage}페이지 이미지 준비</button>}
              {["create", "edit"].includes(transcriptionEntry(page)) && <button type="button" disabled={busy || textSave.blocks(page)} onClick={(): void => startTranscription(page)}>파일 {page.filePage}페이지 직접 전사</button>}
            </div>
          </li>;
        })}</ol>
        {textPages.length > 0 && <button type="button" disabled={busy} onClick={(): void => { void extract(textPages); }}>선택 페이지 텍스트 추출</button>}
      </>}
      {material.file.kind === "image" && selection.pages.map((page): ReactElement => <button type="button" key={page.filePage} disabled={busy} onClick={(): void => { void prepareImage(page.filePage); }}>파일 {page.filePage}페이지 이미지 준비</button>)}
      {material.metadata.kind === "pdf" && job !== null && <PdfRegionPreparation key={`${job.jobId}:${job.revision}`} material={material} binding={job} busy={busy} onProcessing={setBusy} onPrepared={setPrepared} onFailure={setFailure} />}
      {material.metadata.kind === "text" && pages.some((page): boolean => !textSave.blocks(page) && ["pending", "failed"].includes(page.state) && (page.result === null || page.result.status === "failed")) && <button type="button" disabled={busy} onClick={(): void => { void extractTextFile(); }}>선택 텍스트 추출</button>}
      {busy && <button type="button" onClick={(): void => { abort.current?.abort(); }}>추출 중단</button>}
    </div>}
    {prepared !== null && <figure><img src={prepared.image.dataUrl} alt={`파일 ${prepared.filePage}페이지 판독 이미지`} style={{ maxWidth: "100%" }} /><figcaption>파일 {prepared.filePage}페이지 · {prepared.image.width} × {prepared.image.height}px · {prepared.image.bytes.toLocaleString()}바이트 · {prepared.image.region ? "선택 영역만 포함 · 원본 대조 전" : "전체 페이지 · 원본 대조 전"}</figcaption></figure>}
    {prepared !== null && preparedPage !== undefined && <PageVisionControls externalSavePending={textSave.blocks(preparedPage)} key={`${preparedPage.id}:${preparedPage.version}:${prepared.image.sha256}`} materialId={material.id} page={preparedPage} image={prepared.image} onSaved={savedPage} onProcessing={setBusy} onShowExisting={(): void => viewPage(preparedPage.id, "result")} onReadSaved={(): void => { void refresh(); }} onTranscribe={(): void => startTranscription(preparedPage)} />}
    {noticePage !== undefined && <div className="alter-extraction-save-notice"><p role="status">파일 {noticePage.filePage}페이지 · 결과 {noticePage.resultVersion}판을 저장했어요. 원본 대조 전까지 미확인 상태예요.</p><button type="button" onClick={(): void => viewPage(noticePage.id, "result")}>파일 {noticePage.filePage}페이지 저장된 결과 확인</button></div>}
    <ExtractionResults pendingPageIds={textSave.issues.map((issue): string => issue.attempt.pageId)} onReturnToActions={returnToActions} material={material} pages={pages} onSaved={savedPage} target={resultTarget} onTarget={setResultTarget} focusRequest={resultFocus} />
  </section>;
}
