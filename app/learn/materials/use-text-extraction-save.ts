"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { storedExtractionPage } from "@/lib/extraction/state";
import type { StoredExtractionPage } from "@/lib/extraction/state";
import type { PageResult } from "@/lib/extraction/result";
import { errorText, materialJson } from "./client-api";
import { pageSaveAttempt, pageSavePayload, requireSavedPageBinding, savedPageMatches } from "./page-save";
import type { PageSaveAttempt } from "./page-save";

type TextSaveIssue = Readonly<{ attempt: PageSaveAttempt; state: "saving" | "unconfirmed" | "checked"; message: string }>;
type TextExtractionSave = Readonly<{ issues: readonly TextSaveIssue[]; reading: boolean; blocks: (page: StoredExtractionPage) => boolean; save: (page: StoredExtractionPage, result: PageResult, signal: AbortSignal) => Promise<void>; read: (attempt: PageSaveAttempt) => Promise<void>; continueAfterRead: (attempt: PageSaveAttempt) => void }>;

/** 저장 응답이 불명확하면 추출을 반복하지 않고 보관한 의도와 GET 결과만 대조합니다. */
export function useTextExtractionSave(materialId: string, onSaved: (page: StoredExtractionPage) => void): TextExtractionSave {
  const [issues, setIssues] = useState<readonly TextSaveIssue[]>([]);
  const current = useRef<readonly TextSaveIssue[]>([]);
  const active = useRef<boolean>(true);
  const readingRef = useRef<boolean>(false);
  const [reading, setReading] = useState<boolean>(false);
  useEffect((): (() => void) => { active.current = true; return (): void => { active.current = false; }; }, []);
  function replace(next: readonly TextSaveIssue[]): void { current.current = next; if (active.current) setIssues(next); }
  function update(issue: TextSaveIssue): void { replace([...current.current.filter((item): boolean => item.attempt.pageId !== issue.attempt.pageId), issue]); }
  function clear(attempt: PageSaveAttempt): void { replace(current.current.filter((item): boolean => item.attempt.requestKey !== attempt.requestKey)); }
  function blocks(page: StoredExtractionPage): boolean { return issues.some((issue): boolean => issue.attempt.pageId === page.id && issue.attempt.selectionRevision === page.selectionRevision); }
  async function save(page: StoredExtractionPage, result: PageResult, signal: AbortSignal): Promise<void> {
    if (current.current.some((issue): boolean => issue.attempt.pageId === page.id)) throw new Error("앞선 텍스트 저장 결과를 먼저 확인해 주세요.");
    signal.throwIfAborted();
    const attempt: PageSaveAttempt = pageSaveAttempt(page, { kind: "text", result }, crypto.randomUUID());
    update({ attempt, state: "saving", message: "텍스트 저장 응답을 기다리고 있어요." });
    try {
      const reply = z.object({ page: storedExtractionPage }).passthrough().parse(await materialJson(`/api/materials/${materialId}/extraction/pages/${page.id}/text`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": attempt.requestKey }, body: JSON.stringify(pageSavePayload(attempt)), signal }));
      signal.throwIfAborted();
      if (!savedPageMatches(reply.page, attempt)) throw new Error("저장 응답에서 요청한 텍스트를 확인하지 못했어요.");
      if (!active.current) throw new Error("자료 화면이 닫혔어요. 다시 열어 저장 상태를 확인해 주세요.");
      onSaved(reply.page); clear(attempt);
    } catch (error: unknown) { update({ attempt, state: "unconfirmed", message: `텍스트 저장 결과 미확정. 다시 추출하기 전에 저장값을 확인해 주세요. ${errorText(error)}` }); throw error; }
  }
  async function read(attempt: PageSaveAttempt): Promise<void> {
    if (readingRef.current) return;
    readingRef.current = true; setReading(true);
    try {
      const snapshot = z.object({ pages: z.array(storedExtractionPage) }).passthrough().parse(await materialJson(`/api/materials/${materialId}/extraction`, { method: "GET" }));
      if (!active.current) return;
      const latest: StoredExtractionPage | undefined = snapshot.pages.find((page): boolean => page.id === attempt.pageId);
      if (latest === undefined) throw new Error("현재 선택 범위에서 저장 페이지를 찾지 못했어요. 선택 상태를 확인해 주세요.");
      requireSavedPageBinding(latest, attempt); onSaved(latest);
      if (savedPageMatches(latest, attempt)) clear(attempt);
      else update({ attempt, state: "checked", message: `기록 ${latest.version}판을 다시 읽었지만 요청한 텍스트와 일치하지 않아요. 현재 결과를 대조한 뒤 다음 행동을 선택해 주세요.` });
    } catch (error: unknown) { update({ attempt, state: "unconfirmed", message: `텍스트 저장 재조회 실패. 요청 내용은 보관했어요. ${errorText(error)}` }); }
    finally { readingRef.current = false; if (active.current) setReading(false); }
  }
  function continueAfterRead(attempt: PageSaveAttempt): void {
    if (!current.current.some((issue): boolean => issue.attempt.requestKey === attempt.requestKey && issue.state === "checked")) throw new Error("저장 상태를 먼저 다시 읽어 주세요.");
    clear(attempt);
  }
  return { issues, reading, blocks, save, read, continueAfterRead };
}
