"use client";
import type { ReactElement } from "react";
import { AiRequestForm } from "../ai-request-form";
import type { ActionAvailability } from "@/components/alter/action-button";
import type { EditorView } from "@/lib/editor/view";

export type EditorNewAiKind = "feedback" | "review" | "variation";
const labels: Readonly<Record<EditorNewAiKind, string>> = { feedback: "저장한 초안 피드백 받기", review: "수정본과 이유 재검토", variation: "새 조건에서 직접 풀기" };
const transmissions: Readonly<Record<EditorNewAiKind, string>> = {
  feedback: "OpenAI로 확정된 선택 원문·현재 과제·저장한 초안·해당 평가 기준을 보내요.",
  review: "OpenAI로 확정된 선택 원문·현재 과제·원래 초안·연결 피드백·저장한 수정본과 수정 이유·해당 평가 기준을 보내요.",
  variation: "OpenAI로 확정된 선택 원문·현재 과제와 저장 답안·단원 목표·현재 질문의 도움 기록을 보내 새 조건 과제를 요청해요.",
};
export function EditorNewAiAction({ action, view, availability, onRequest }: Readonly<{ action: EditorNewAiKind; view: EditorView; availability: ActionAvailability; onRequest: () => void }>): ReactElement {
  return <AiRequestForm id={`editor-ai-${action}`} label={labels[action]} transmission={transmissions[action]} photoCount={view.versions.at(-1)?.fileIds.length ?? 0} availability={availability} onRequest={onRequest}/>;
}
