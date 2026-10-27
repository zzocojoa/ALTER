import { tutorAiIntent } from "@/lib/tutor/ai-observation";
import type { TutorAiIntent } from "@/lib/tutor/ai-observation";

const prefix: string = "alter:tutor-ai-intent:";
/** 답안이나 원문 없이 회차·버전·요청 키만 보관합니다. */
export function rememberTutorAiIntent(intent: TutorAiIntent): void {
  sessionStorage.setItem(prefix + intent.input.id, JSON.stringify(tutorAiIntent.parse(intent)));
}
export function readTutorAiIntent(id: string): TutorAiIntent | null {
  const value: string | null = sessionStorage.getItem(prefix + id);
  if (value === null) return null;
  const intent = tutorAiIntent.parse(JSON.parse(value));
  if (intent.input.id !== id) throw new Error("보관된 AI 요청의 수업 ID가 달라요. 새 요청을 보내지 않았어요.");
  return intent;
}
export function clearTutorAiIntent(id: string): void { sessionStorage.removeItem(prefix + id); }
