"use client";
import { useState } from "react";
import type { ReactElement } from "react";
import { z } from "zod";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import { errorText, materialJson } from "./client-api";

const sourceReply = z.object({ valid: z.literal(true), source: z.object({ id: z.string().uuid(), filePage: z.number().int().positive(), printedPage: z.string().nullable(), evidence: z.string() }).passthrough() }).passthrough();
export function ConfirmedSource({ materialId, page, segmentId }: Readonly<{ materialId: string; page: StoredExtractionPage; segmentId: string }>): ReactElement {
  const [source, setSource] = useState<z.infer<typeof sourceReply>["source"] | null>(null);
  const [busy, setBusy] = useState<boolean>(false); const [failure, setFailure] = useState<string>("");
  async function connect(): Promise<void> {
    setBusy(true); setFailure("");
    try { const reply = sourceReply.parse(await materialJson(`/api/materials/${materialId}/extraction/pages/${page.id}/sources`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ selectionRevision: page.selectionRevision, filePage: page.filePage, expectedVersion: page.version, segmentId }) })); setSource(reply.source); }
    catch (error: unknown) { setFailure(errorText(error)); } finally { setBusy(false); }
  }
  return <div className="alter-confirmed-source"><p>확인된 본문을 학습 근거로 연결해요. 교재의 저자·출판사·판본 확인은 별도예요.</p><button type="button" disabled={busy} onClick={(): void => { void connect(); }}>확인 구간 출처 연결</button>{failure && <p role="alert">{failure}</p>}{source && <p role="status">학습 근거로 연결됨 · 파일 {source.filePage}페이지{source.printedPage ? ` · 인쇄 쪽수 ${source.printedPage}` : ""} · <a href={`/learn/source/${source.id}`}>연결한 원본 구간 보기</a></p>}</div>;
}
