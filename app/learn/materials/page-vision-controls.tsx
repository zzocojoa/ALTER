"use client";

import { useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { z } from "zod";
import { storedExtractionPage } from "@/lib/extraction/state";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import type { PreparedPageImage } from "@/lib/extraction/image";
import { errorText, materialJson } from "./client-api";

type Props = Readonly<{ materialId: string; page: StoredExtractionPage; image: PreparedPageImage; onProcessing: (busy: boolean) => void; onSaved: (page: StoredExtractionPage) => void }>;
export function PageVisionControls({ materialId, page, image, onSaved, onProcessing }: Props): ReactElement {
  const [busy, setBusy] = useState<boolean>(false); const [failure, setFailure] = useState<string>("");
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const data: FormData = new FormData(event.currentTarget); setBusy(true); onProcessing(true); setFailure("");
    try {
      const reply = z.object({ page: storedExtractionPage }).passthrough().parse(await materialJson(`/api/materials/${materialId}/extraction/pages/${page.id}/vision`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ selectionRevision: page.selectionRevision, filePage: page.filePage, expectedVersion: page.version, image, comparedWithOriginal: data.get("compared") === "on" }) }));
      onSaved(reply.page);
    } catch (error: unknown) { setFailure(`${errorText(error)} 저장 상태를 다시 확인해 주세요. 응답 불명인 요청은 자동 재생성하지 않습니다.`); }
    finally { setBusy(false); onProcessing(false); }
  }
  return <form onSubmit={submit} aria-label={`파일 ${page.filePage}페이지 AI 판독`}><fieldset disabled={busy || page.state === "running" || page.state === "unknown"}><p>이 이미지 한 장을 OpenAI로 보내요. 판독 결과는 원본 대조 전까지 미확인 상태로 보관합니다.</p><label><input type="checkbox" name="compared" required /> 준비 이미지가 선택한 파일 {page.filePage}페이지의 원본과 같은 내용임을 확인했어요.</label><button type="submit">{busy ? "페이지 판독 중…" : "이 페이지 AI 판독"}</button></fieldset>{failure && <p role="alert">{failure}</p>}</form>;
}
