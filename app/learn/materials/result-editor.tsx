"use client";

import { useRef, useState } from "react";
import type { FormEvent, ReactElement, RefObject } from "react";
import { z } from "zod";
import { storedExtractionPage } from "@/lib/extraction/state";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import { transcriptionEntry } from "@/lib/extraction/transcription";
import { requirePageResponse } from "./page-response";
import { ConfirmedSource } from "./confirmed-source";
import { originalSegmentLocation } from "./segment-location";
import { errorText, materialJson } from "./client-api";
import { completedResultDraft, confirmationOf, correctionOf, replaceCorrection, selectConfirmation } from "./result-draft";
import { pageSaveAttempt, pageSaveLabel, pageSavePayload, requireSavedPageBinding, savedPageMatches } from "./page-save";
import type { PageSaveAttempt } from "./page-save";
import type { ConfirmationDraft, CorrectionDraft, ResultDraft } from "./result-draft";

type EditorProps = Readonly<{ externalSavePending: boolean; headingRef: RefObject<HTMLHeadingElement | null>; materialId: string; page: StoredExtractionPage; onLocate: (segmentId: string) => void; draft: ResultDraft; onDraft: (update: (current: ResultDraft) => ResultDraft) => void; onSaved: (page: StoredExtractionPage) => void }>;
async function savePageAction(url: string, payload: unknown, requestKey: string): Promise<StoredExtractionPage> {
  const reply = z.object({ page: storedExtractionPage }).passthrough().parse(await materialJson(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": requestKey }, body: JSON.stringify(payload) }));
  return reply.page;
}
export function ResultEditor({ materialId, page, onSaved, onLocate, draft, onDraft, headingRef, externalSavePending }: EditorProps): ReactElement {
  const [busy, setBusy] = useState<boolean>(false); const [failure, setFailure] = useState<string>("");
  const inFlight = useRef<boolean>(false);
  const entry = transcriptionEntry(page);
  const base: string = `/api/materials/${materialId}/extraction/pages/${page.id}`;
  const correction: CorrectionDraft = correctionOf(page, draft);
  const confirmation: ConfirmationDraft = confirmationOf(page, draft);
  const correctionConflict: boolean = correction.resultId !== page.resultId || correction.resultVersion !== page.resultVersion;
  const savingBlocked: boolean = externalSavePending || busy || ["saving", "unconfirmed", "checked"].includes(draft.save.kind);
  async function persist(attempt: PageSaveAttempt): Promise<void> {
    if (savingBlocked || inFlight.current) { setFailure("앞선 저장 결과를 먼저 확인해 주세요."); return; }
    inFlight.current = true; setBusy(true); setFailure(""); onDraft((current): ResultDraft => ({ ...current, save: { kind: "saving", attempt } }));
    try {
      const saved: StoredExtractionPage = await savePageAction(`${base}/${attempt.intent.kind === "transcribe" ? "edit" : attempt.intent.kind}`, pageSavePayload(attempt), attempt.requestKey);
      if (!savedPageMatches(saved, attempt)) throw new Error("저장 응답에서 요청한 내용을 확인하지 못했어요. 현재 저장 결과를 다시 읽어 주세요.");
      onSaved(saved); onDraft((current): ResultDraft => completedResultDraft(current, attempt, `${pageSaveLabel(attempt.intent)} 저장 확인 · 기록 ${saved.version}판`));
    } catch (error: unknown) {
      onDraft((current): ResultDraft => ({ ...current, save: { kind: "unconfirmed", attempt, message: `${pageSaveLabel(attempt.intent)} 저장 실패·결과 미확정. 입력은 보관했어요. ${errorText(error)}` } }));
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function label(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const data: FormData = new FormData(event.currentTarget);
    await persist(pageSaveAttempt(page, { kind: "label", printedPage: String(data.get("printedPage") ?? "").trim() || null }, crypto.randomUUID()));
  }
  async function confirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const data: FormData = new FormData(event.currentTarget);
    const segmentIds: string[] = data.getAll("segment").map(String);
    if (draft.correction !== null) { setFailure("작성 중인 전사를 먼저 저장한 뒤 원본과 대조해 주세요."); return; }
    if (segmentIds.length === 0 || data.get("compared") !== "on") { setFailure("원본과 대조한 구간을 선택하고 대조 여부를 확인해 주세요."); return; }
    await persist(pageSaveAttempt(page, { kind: "confirm", segmentIds, printedPage: page.printedPage, comparedWithOriginal: true }, crypto.randomUUID()));
  }
  async function edit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (correctionConflict) { setFailure("수정 중 추출 결과의 판이 달라졌어요. 보관된 초안과 최신 결과를 대조해 주세요."); return; }
    await persist(pageSaveAttempt(page, { kind: "edit", segments: correction.segments }, crypto.randomUUID()));
  }
  async function transcribe(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (entry !== "create" || correctionConflict) { setFailure("저장 상태가 바뀌었어요. 보관한 전사와 현재 결과를 먼저 대조해 주세요."); return; }
    await persist(pageSaveAttempt(page, { kind: "transcribe", segments: correction.segments }, crypto.randomUUID()));
  }
  async function readSavedResult(): Promise<void> {
    if (inFlight.current || (draft.save.kind !== "unconfirmed" && draft.save.kind !== "checked")) return;
    inFlight.current = true;
    const attempt: PageSaveAttempt = draft.save.attempt;
    setBusy(true); setFailure("");
    try {
      const snapshot = z.object({ pages: z.array(storedExtractionPage) }).passthrough().parse(await materialJson(`/api/materials/${materialId}/extraction`, { method: "GET" }));
      const latest: StoredExtractionPage | undefined = snapshot.pages.find((item): boolean => item.id === attempt.pageId);
      if (latest === undefined) throw new Error("현재 선택 범위에서 저장 페이지를 찾지 못했어요. 초안을 보관하고 선택 범위를 다시 확인해 주세요.");
      requireSavedPageBinding(latest, attempt); onSaved(latest);
      if (savedPageMatches(latest, attempt)) onDraft((current): ResultDraft => completedResultDraft(current, attempt, `${pageSaveLabel(attempt.intent)} 내용이 현재 저장값과 일치해요 · 기록 ${latest.version}판 재조회 확인`));
      else onDraft((current): ResultDraft => ({ ...current, save: { kind: "checked", attempt, message: `기록 ${latest.version}판을 다시 읽었지만 요청한 저장 내용과 일치하지 않아요. 아래 최신 결과와 보관한 입력을 대조해 주세요.` } }));
    } catch (error: unknown) { setFailure(errorText(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function recover(): Promise<void> {
    if (savingBlocked || inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setFailure("");
    try { const saved: StoredExtractionPage = await savePageAction(`${base}/recover`, { selectionRevision: page.selectionRevision, filePage: page.filePage }, crypto.randomUUID()); requirePageResponse(saved, page); onSaved(saved); }
    catch (error: unknown) { setFailure(errorText(error)); } finally { inFlight.current = false; setBusy(false); }
  }
  const result = page.result;
  return <article aria-label={`파일 ${page.filePage}페이지 추출 결과`}>
    <h4 ref={headingRef} tabIndex={-1}>파일 {page.filePage}페이지 · 결과 {page.resultVersion}판</h4>
    <p className="alter-caption">저장 기록 {page.version}판 · {page.result === null ? "추출 결과 대기" : page.result.method === "manual-correction" ? "사용자 정정본" : page.result?.method === "vision" ? "AI 판독본 · 자동 확정 아님" : "텍스트 추출본 · 자동 확정 아님"}</p>
    {page.resultVersion > 1 && <aside className="alter-extraction-metadata" aria-label="정정 후 학습 재검토"><p>새 결과 판이에요. 이전 판의 출처를 사용한 학습 범위·수업은 다시 검토해야 해요. 이 화면에서는 연결된 학습 개수를 조회하지 않았어요.</p><a href="/learn/library">연결한 학습 범위 재검토</a></aside>}
    {draft.save.kind === "saving" && <p role="status">{pageSaveLabel(draft.save.attempt.intent)} 저장 중… 완료 응답을 기다리고 있어요.</p>}
    {draft.save.kind === "saved" && <p role="status">{draft.save.message}</p>}
    {(draft.save.kind === "unconfirmed" || draft.save.kind === "checked") && <div className="alter-extraction-save-issue"><p role="alert">{draft.save.message}</p><button type="button" disabled={busy} onClick={(): void => { void readSavedResult(); }}>저장 결과 다시 읽기</button><p>이 확인은 저장값을 읽기만 해요. 새 수정이나 AI 판독을 실행하지 않아요.</p>{draft.save.kind === "checked" && <button type="button" disabled={busy} onClick={(): void => onDraft((current): ResultDraft => ({ ...current, save: { kind: "idle" } }))}>재조회한 결과와 대조하고 편집 이어가기</button>}</div>}
    {page.resultImage?.region && <p>영역 판독 결과 · 원본 왼쪽 {Math.round(page.resultImage.region.x*1000)/10}%, 위쪽 {Math.round(page.resultImage.region.y*1000)/10}%, 너비 {Math.round(page.resultImage.region.width*1000)/10}%, 높이 {Math.round(page.resultImage.region.height*1000)/10}%. 영역 밖은 판독하지 않았어요.</p>}
    <form onSubmit={label} className="alter-extraction-form" aria-label="인쇄 쪽수 저장"><fieldset disabled={savingBlocked}><legend>쪽수 표시</legend><label>인쇄된 쪽수 <input name="printedPage" value={draft.printedPage ?? page.printedPage ?? ""} onChange={(event): void => { const value: string = event.target.value; onDraft((current): ResultDraft => ({ ...current, printedPage: value })); }} maxLength={40} placeholder="예: iii, 12 또는 빈칸" /></label><button type="submit">쪽수 저장</button></fieldset></form>
    <p className="material-note">파일 번호는 고정돼요. 인쇄된 쪽수는 표지·로마 숫자·누락 쪽수를 표시하는 별도 정보예요.</p>
    {failure && <p role="alert">{failure}</p>}
    {page.state === "unknown" || page.state === "running" ? <p role="status">AI 처리 결과 확인이 필요해요. 기존 요청을 확인하며 자동으로 다시 생성하지 않습니다. <button type="button" disabled={savingBlocked} onClick={(): void => { void recover(); }}>기존 AI 요청 결과 확인</button></p> : page.failure && <p role="alert">{page.failure}</p>}
    {result === null ? <p>아직 저장된 추출 결과가 없어요.</p> : <>
      {result.status === "blank" && <p>빈 페이지예요.</p>}{result.status === "no-text" && <p>추출된 텍스트가 없어요. 원본을 확인한 뒤 비전 판독이나 직접 전사를 선택해 주세요.</p>}{result.status === "unreadable" && <p>판독할 수 없는 페이지예요. 원본을 다시 확인해 주세요.</p>}
      <form onSubmit={confirm} className="alter-extraction-form" aria-label="원본 대조 확인"><fieldset disabled={savingBlocked || page.state !== "complete" || result.status !== "complete"}><legend>원본과 대조한 구간 확인</legend>
        {result.segments.map((segment, index): ReactElement => <section key={segment.id} className="extraction-segment" aria-label={`구간 ${index + 1}`}>
          <p><strong>{segment.kind === "formula" ? "수식" : segment.kind === "table" ? "표" : segment.kind === "unreadable" ? "판독 불가" : "텍스트"}</strong> · {page.confirmedSegmentIds.includes(segment.id) ? "확인됨" : "미확인"}</p>
          <button type="button" onClick={(): void => onLocate(segment.id)}>구간 {index + 1} {originalSegmentLocation(page, segment).kind === "located" ? "원본 위치" : "원본 페이지"}</button>
          <pre className="material-text" tabIndex={0} aria-label={`구간 ${index + 1} 추출 내용`}>{segment.text || "읽을 수 있는 내용이 없어요."}</pre>
          {segment.uncertain && <p className="extraction-uncertain">확인 필요: {segment.reason}</p>}
          {page.confirmedSegmentIds.includes(segment.id) ? <div><p>이 버전의 구간을 원본과 대조했어요.</p><ConfirmedSource key={`${page.resultId}:${page.version}`} materialId={materialId} page={page} segmentId={segment.id} /></div> : <label className="alter-extraction-check"><input type="checkbox" name="segment" value={segment.id} checked={confirmation.segmentIds.includes(segment.id)} onChange={(event): void => { const checked: boolean = event.target.checked; onDraft((current): ResultDraft => selectConfirmation(page, current, segment.id, checked)); }} disabled={draft.correction !== null || segment.kind === "unreadable" || !segment.text.trim()} /><span>구간 {index + 1} 확인</span></label>}
        </section>)}
        <label className="alter-extraction-check"><input type="checkbox" name="compared" disabled={draft.correction !== null} checked={confirmation.compared} onChange={(event): void => { const compared: boolean = event.target.checked; onDraft((current): ResultDraft => ({ ...current, confirmation: { ...confirmationOf(page, current), compared } })); }} required /><span>선택한 구간을 이 파일 페이지의 원본과 대조했어요.</span></label><button type="submit" disabled={draft.correction !== null}>선택 구간 확인 저장</button>{draft.correction !== null && <p>작성 중인 전사를 먼저 저장한 뒤 최신 결과를 원본과 대조해 주세요.</p>}
      </fieldset></form>
    </>}
    {(entry === "create" || entry === "edit" || draft.correction !== null) && <details className="alter-extraction-correction" open={entry === "create"}><summary>{entry === "create" ? "직접 전사 작성" : "추출 내용 수정"}</summary><p>수정본을 저장하면 모든 구간이 다시 미확인 상태가 됩니다. 쪽수·서지정보 저장과는 별개예요.</p>
        {draft.correction !== null && <p role="status">결과 {correction.resultVersion}판에서 작성 중인 수정문 · 아직 서버에 저장하지 않았어요.</p>}
        {correctionConflict && <div role="alert"><p>최신 결과는 {page.resultVersion}판이에요. 이전 초안은 보관했으며 새 판에 자동 적용하지 않아요. 필요한 문장을 복사한 뒤 최신 결과로 수정 작업을 시작해 주세요.</p><button type="button" onClick={(): void => onDraft((current): ResultDraft => ({ ...current, correction: null }))}>보관 초안을 지우고 최신 결과로 수정 시작</button></div>}
        <form onSubmit={entry === "create" ? transcribe : edit} className="alter-extraction-form" aria-label={entry === "create" ? "직접 전사 저장" : "추출 내용 수정 저장"}><fieldset disabled={savingBlocked || (entry !== "create" && entry !== "edit")}><legend>본문 수정</legend>
          {correction.segments.map((segment, index): ReactElement => <label key={segment.id}>구간 {index + 1} 수정 <textarea name={segment.id} value={segment.text} onChange={(event): void => { const value: string = event.target.value; onDraft((current): ResultDraft => replaceCorrection(page, current, segment.id, value)); }} maxLength={60000} rows={5} /></label>)}
          <button type="submit" disabled={correctionConflict || !correction.segments.some((segment): boolean => segment.text.trim().length > 0)}>{entry === "create" ? "전사본 저장" : "수정본 저장"}</button>
        </fieldset></form>
      </details>}
  </article>;
}

