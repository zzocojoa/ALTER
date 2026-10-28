"use client";
import type { ReactElement } from "react";
import { AiRequestForm } from "../ai-request-form";
import { ActionButton, type ActionAvailability } from "@/components/alter/action-button";
import type { TutorView } from "@/lib/tutor/view";

export type TutorNewAiKind = "lesson" | "diagnose" | "help" | "variation";
const newRequestLabels: Readonly<Record<TutorNewAiKind, string>> = { lesson: "작은 개념 설명 받기", diagnose: "저장한 답안 진단", help: "다음 단계 도움 요청", variation: "새 조건 과제 요청" };
const pendingLabels: Readonly<Record<NonNullable<TutorView["pending"]>["kind"], string>> = { "tutor-lesson": "개념 설명", "tutor-diagnosis": "답안 진단", "tutor-scaffold": "단계별 도움", "tutor-variation": "새 조건 과제", "editor-draft-feedback": "초안 피드백", "editor-revision-review": "수정본 평가" };

export function TutorNewAiAction({ action, view, availability, onRequest }: Readonly<{ action: TutorNewAiKind; view: TutorView; availability: ActionAvailability; onRequest: () => void }>): ReactElement {
  return <AiRequestForm id={`tutor-ai-${action}`} label={newRequestLabels[action]} transmission="OpenAI로 이 단원의 확정된 선택 원문·현재 질문·제출 답안·현재 질문의 도움 기록과 복습 조건을 보내요." photoCount={view.answers.at(-1)?.fileIds.length ?? 0} availability={availability} onRequest={onRequest}/>;
}

export function TutorPendingAi({ pending, availability, onRecover }: Readonly<{ pending: NonNullable<TutorView["pending"]>; availability: ActionAvailability; onRecover: () => void }>): ReactElement {
  return <section className="tutor-ai-recovery" aria-label="기존 AI 요청 확인" data-ai-intent="existing"><h3>{pendingLabels[pending.kind]} · 기존 요청 확인 대기</h3><p>저장된 같은 요청의 결과만 확인해요. 새 생성이나 새 비용 예약으로 바꾸지 않아요. 기록이 없거나 확인에 실패하면 멈추고 이유를 표시해요.</p><p>화면을 닫아도 이미 전송된 요청의 비용이 취소되지는 않아요.</p><ActionButton id="tutor-ai-recover" type="button" tone="secondary" availability={availability} onClick={onRecover}>기존 요청 결과 확인</ActionButton></section>;
}
