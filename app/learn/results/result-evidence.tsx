"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { canonicalJson } from "@/lib/domain/contracts";
import { RECALL_START_EVENT } from "@/lib/tutor/client-privacy";
import { resultEvidenceDetail, type ResultEvidenceDetail } from "@/lib/results/evidence-detail";
import type { ResultEvidence } from "@/lib/results/contracts";
import { librarianJson } from "../library/client-api";

type EvidenceProps = Readonly<{ resultId: string; fingerprint: string; value: ResultEvidence | null; label: string }>;
/** 펼칠 때만 같은 결과 지문의 답안 근거를 조회하며 가림·접기 때 내용을 해제합니다. */
export function ResultEvidenceCard({ resultId, fingerprint, value, label }: EvidenceProps): ReactElement {
  const [detail, setDetail] = useState<ResultEvidenceDetail | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const active = useRef<AbortController | null>(null);
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect((): (() => void) => {
    function conceal(): void { active.current?.abort(); setDetail(null); setError(""); setBusy(false); if (panel.current) panel.current.open = false; }
    function visibility(): void { if (document.visibilityState === "hidden") conceal(); }
    window.addEventListener("pagehide", conceal); window.addEventListener(RECALL_START_EVENT, conceal); document.addEventListener("visibilitychange", visibility);
    return (): void => { active.current?.abort(); window.removeEventListener("pagehide", conceal); window.removeEventListener(RECALL_START_EVENT, conceal); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  async function read(): Promise<void> {
    if (!value) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller; setBusy(true); setError(""); setDetail(null);
    try {
      const params = new URLSearchParams({ id: resultId, answerId: value.answerId, fingerprint });
      const data = resultEvidenceDetail.parse(await librarianJson(`/api/results?${params}`, { method: "GET", signal: controller.signal }));
      if (data.resultId !== resultId || data.fingerprint !== fingerprint || canonicalJson(data.evidence) !== canonicalJson(value) || data.answer.id !== value.answerId || data.answer.version !== value.answerVersion || data.question.id !== value.questionId) throw new Error("다른 버전의 근거 응답이에요. 서버 최신 기록을 확인한 뒤 다시 열어 주세요.");
      if (!controller.signal.aborted) setDetail(data);
    } catch (cause: unknown) { if (!(cause instanceof Error)) throw cause; if (!controller.signal.aborted) setError("답안 근거를 확인하지 못했어요. " + cause.message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="result-evidence" aria-label={label}><h3>{label} · {value === null ? "미확인" : value.accepted ? "충족 근거 있음" : "충족 근거 부족"}</h3>{value ? <><p>{value.observation}</p>{value.reasons.length > 0 && <ul className="result-evidence-reasons">{value.reasons.map((reason): ReactElement => <li key={reason}>{reason}</li>)}</ul>}<small>답안 버전 {value.answerVersion ?? "미확인"} · 회차 {value.sessionVersion}판 · 이 질문의 도움 {value.helpIds.length}개</small>
    <details ref={panel} onToggle={(event): void => { if (event.currentTarget.open) void read(); else { active.current?.abort(); setDetail(null); setBusy(false); setError(""); } }}><summary>답안·원문 근거 열기</summary>
      {busy && <p role="status">저장된 답안과 연결 근거를 확인하고 있어요.</p>}{error && <div role="alert"><p>{error}</p><button type="button" onClick={(): void => { void read(); }}>이 답안 근거 다시 확인</button></div>}
      {detail && <div className="result-evidence-detail"><h4>당시 질문과 기준</h4><p>{detail.question.prompt}</p><p>{detail.question.criterion}</p><h4>제출한 답안 · {detail.answer.version}판</h4><blockquote>{detail.answer.text || "글 없이 사진으로 제출한 답안이에요."}</blockquote>{detail.answer.fileIds.map((id, index): ReactElement => <p key={id}><a href={`/api/materials/${id}/file`} target="_blank" rel="noopener noreferrer">이 답안 사진 {index + 1} 원본 (새 탭)</a></p>)}<h4>당시 확정 학습 범위의 원문</h4><p className="alter-caption">파일 쪽수와 인쇄 쪽수는 달라요. 원문을 열 때 현재 출처 상태를 다시 확인해요.</p><ul>{detail.sources.map((source): ReactElement => <li key={source.id}><a href={`/learn/source/${source.id}`} target="_blank" rel="noopener noreferrer">파일 {source.filePage}쪽 · 인쇄 {source.printedPage ?? "미확인"} · 구간 {source.spanStart}–{source.spanEnd} 원문 (새 탭)</a></li>)}</ul></div>}
    </details></> : <p>기준을 충족한 저장 답안과 평가가 아직 없어요.</p>}</section>;
}
