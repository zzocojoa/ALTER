import { editorAiIntent } from "@/lib/editor/ai-observation";
import type { EditorAiIntent } from "@/lib/editor/ai-observation";

const prefix: string = "alter:editor-ai-intent:";
/** 초안·수정 이유를 제외한 요청 식별자만 같은 탭의 복구에 사용합니다. */
export function rememberEditorAiIntent(intent: EditorAiIntent): void { sessionStorage.setItem(prefix + intent.input.id, JSON.stringify(editorAiIntent.parse(intent))); }
export function readEditorAiIntent(id: string): EditorAiIntent | null {
  const value: string | null = sessionStorage.getItem(prefix + id);
  if (value === null) return null;
  const intent = editorAiIntent.parse(JSON.parse(value));
  if (intent.input.id !== id) throw new Error("보관된 AI 요청의 첨삭 ID가 달라요. 새 요청을 보내지 않았어요.");
  return intent;
}
export function clearEditorAiIntent(id: string): void { sessionStorage.removeItem(prefix + id); }
