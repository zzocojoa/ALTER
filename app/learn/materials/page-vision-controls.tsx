"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { z } from "zod";
import { storedExtractionPage } from "@/lib/extraction/state";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import type { PreparedPageImage } from "@/lib/extraction/image";
import { transcriptionEntry } from "@/lib/extraction/transcription";
import { ActionButton } from "@/components/alter/action-button";
import { usageDashboard } from "@/lib/dashboard/usage";
import type { UsageDashboard } from "@/lib/dashboard/usage";
import { visionBlock, visionSubmissionBlock, visionCostReadFailure } from "./vision-permission";
import type { VisionBlock } from "./vision-permission";
import { requirePageResponse } from "./page-response";
import { VisionCostSummary } from "./vision-cost-summary";
import { errorText, materialJson } from "./client-api";

type Props = Readonly<{ externalSavePending: boolean; materialId: string; page: StoredExtractionPage; image: PreparedPageImage; onProcessing: (busy: boolean) => void; onSaved: (page: StoredExtractionPage) => void; onShowExisting: () => void; onReadSaved: () => void; onTranscribe: () => void }>;
export function PageVisionControls({ materialId, page, image, onSaved, onProcessing, onShowExisting, onReadSaved, onTranscribe, externalSavePending }: Props): ReactElement {
  const [busy, setBusy] = useState<boolean>(false); const [failure, setFailure] = useState<string>("");
  const [cost, setCost] = useState<UsageDashboard | null>(null);
  const [reading, setReading] = useState<boolean>(false);
  const [observedAt, setObservedAt] = useState<number>(0);
  const costRequest = useRef<AbortController | null>(null);
  const [readFailure, setReadFailure] = useState<VisionBlock | null>(null);
  const [submissionBlock, setSubmissionBlock] = useState<VisionBlock | null>(null);
  const inFlight = useRef<boolean>(false);
  const currentCondition: VisionBlock | null = visionBlock(page, cost, observedAt);
  const blocked: VisionBlock | null = currentCondition?.action === "request-result" ? currentCondition : submissionBlock ?? readFailure ?? currentCondition;
  const unavailable: string | null = externalSavePending ? "앞선 텍스트 저장 결과를 먼저 확인해 주세요. 페이지의 저장 재조회 버튼으로 확인할 수 있어요." : blocked?.reason ?? null;
  useEffect((): (() => void) => {
    const timer: number = window.setInterval((): void => setObservedAt(Date.now()), 10_000);
    function hide(): void { costRequest.current?.abort(); setCost(null); setReading(false); }
    function visibility(): void { if (document.visibilityState === "hidden") hide(); }
    window.addEventListener("pagehide", hide); document.addEventListener("visibilitychange", visibility);
    return (): void => { window.clearInterval(timer); costRequest.current?.abort(); window.removeEventListener("pagehide", hide); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  async function readCost(): Promise<void> {
    costRequest.current?.abort(); const controller: AbortController = new AbortController(); costRequest.current = controller;
    setReading(true); setCost(null); setFailure(""); setReadFailure(null);
    try {
      const snapshot: UsageDashboard = usageDashboard.parse(await materialJson("/api/dashboard/usage", { method: "GET", signal: controller.signal }));
      if (!controller.signal.aborted) { setCost(snapshot); setObservedAt(Date.now()); }
    } catch (error: unknown) { if (!controller.signal.aborted) { const blocked: VisionBlock = visionCostReadFailure(errorText(error)); setReadFailure(blocked); setFailure(blocked.reason); } }
    finally { if (costRequest.current === controller) setReading(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current) return;
    if (externalSavePending) { setFailure("앞선 텍스트 저장 결과를 먼저 확인해 주세요."); return; }
    const currentBlock: VisionBlock | null = submissionBlock ?? readFailure ?? visionBlock(page, cost, Date.now());
    if (currentBlock !== null) { setFailure(currentBlock.reason); return; }
    const data: FormData = new FormData(event.currentTarget); inFlight.current = true; setBusy(true); onProcessing(true); setFailure("");
    try {
      const reply = z.object({ page: storedExtractionPage }).passthrough().parse(await materialJson(`/api/materials/${materialId}/extraction/pages/${page.id}/vision`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ selectionRevision: page.selectionRevision, filePage: page.filePage, expectedVersion: page.version, image, comparedWithOriginal: data.get("compared") === "on" }) }));
      requirePageResponse(reply.page, page); onSaved(reply.page);
    } catch (error: unknown) { setSubmissionBlock(visionSubmissionBlock(error)); setFailure(`${errorText(error)} 저장 상태를 다시 확인해 주세요. 응답 불명인 요청은 자동 재생성하지 않습니다.`); }
    finally { inFlight.current = false; setBusy(false); onProcessing(false); }
  }
  return <form onSubmit={submit} aria-label={`파일 ${page.filePage}페이지 AI 판독`} className="alter-vision-form">
    <h4>파일 {page.filePage}페이지 AI 판독</h4>
    <p>전송 대상: OpenAI · 이미지 한 장 · {image.width} × {image.height}px · {image.bytes.toLocaleString("ko-KR")}바이트 · 회전 {image.rotation}°</p>
    <p>{image.region ? `선택 영역만 전송: 왼쪽 ${Math.round(image.region.x * 1000) / 10}%, 위쪽 ${Math.round(image.region.y * 1000) / 10}%, 너비 ${Math.round(image.region.width * 1000) / 10}%, 높이 ${Math.round(image.region.height * 1000) / 10}%` : "선택한 파일 페이지 전체를 전송해요."} 다른 페이지는 이 요청에 포함하지 않아요.</p>
    <p>판독 결과는 원본 대조 전까지 미확인 상태로 보관합니다.</p>
    <button type="button" disabled={busy || reading} onClick={(): void => { void readCost(); }}>{reading ? "저장된 조건 확인 중…" : "저장된 비용·승인 조건 확인"}</button>
    <p className="alter-caption">이 조회·재조회에는 AI 비용이 없어요. 조회가 끝나도 판독을 자동 실행하지 않아요.</p>
    {blocked?.action === "cost-details" && <a href="/learn#check-budget">사용량과 비용에서 차단 조건 확인</a>}
    {blocked?.action === "request-result" && <button type="button" disabled={busy} onClick={onShowExisting}>기존 요청 결과 확인</button>}
    {submissionBlock !== null && <button type="button" disabled={busy} onClick={onReadSaved}>판독 요청의 저장 상태 확인</button>}
    {["create", "edit"].includes(transcriptionEntry(page)) && <button type="button" disabled={busy || externalSavePending || submissionBlock?.code === "save-unconfirmed"} onClick={onTranscribe}>AI 없이 직접 전사</button>}
    {cost !== null && <VisionCostSummary data={cost} />}
    <fieldset disabled={busy || reading || unavailable !== null}>
      <label className="alter-extraction-check"><input type="checkbox" name="compared" required /><span>준비 이미지가 선택한 파일 {page.filePage}페이지의 원본과 같은 내용임을 확인했어요.</span></label>
      <ActionButton id={`vision-submit-${page.id}`} type="submit" tone="primary" availability={busy ? { kind: "busy", reason: "현재 요청을 처리하고 있어요." } : reading ? { kind: "busy", reason: "비용 원장을 읽고 있어요." } : unavailable !== null ? { kind: "blocked", reason: unavailable } : { kind: "available" }}>{busy ? "페이지 판독 중…" : "이 페이지 AI 판독"}</ActionButton>
    </fieldset>
    {failure && <p role="alert">{failure}</p>}
  </form>;
}
