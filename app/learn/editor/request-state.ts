import { canonicalJson } from "@/lib/domain/contracts";
import type { EditorAction } from "@/lib/editor/actions";
import type { EditorView } from "@/lib/editor/view";
import type { SaveState } from "@/lib/ui/save-status";
import { requireTutorResponse } from "../tutor/request-state";
import type { TutorWriteFailure } from "../tutor/request-state";

export type EditorWrite = Extract<EditorAction, { action: "draft" | "submit" | "revision-draft" | "revision-submit" }>;
export type PendingEditorRequest = Readonly<{ body: string; key: string; input: EditorAction }>;
export function isEditorWrite(input: EditorAction): input is EditorWrite { return ["draft", "submit", "revision-draft", "revision-submit"].includes(input.action); }
export function requireEditorResponse(id: string, previous: EditorView | null, next: EditorView): void { requireTutorResponse(id, previous?.tutor ?? null, next.tutor); }

/** 동일 초안 또는 동일 제출 ID·내용이 보일 때만 이전 저장의 결과 불명을 해소합니다. */
export function observedEditorWrite(input: EditorAction, next: EditorView): boolean {
  if (input.id !== next.tutor.id) return false;
  if (input.action === "draft" || input.action === "revision-draft") return canonicalJson(input.draft) === canonicalJson(next.tutor.draft) && (input.action === "draft" || input.reason === next.draftReason);
  if (input.action === "submit" || input.action === "revision-submit") return next.versions.some((item): boolean => item.answerId === input.answerId && item.text === input.draft.text && canonicalJson(item.fileIds) === canonicalJson(input.draft.fileIds) && (input.action === "submit" || item.attemptId === input.attemptId && item.reason === input.reason.trim()));
  return false;
}
export function editorSaveState(view: EditorView, saved: boolean, action: EditorAction["action"] | null, failure: TutorWriteFailure | null): SaveState {
  if (failure) return failure;
  if (action === "draft" || action === "revision-draft") return { kind: "saving" };
  if (["draft", "awaiting-revision"].includes(view.phase)) return saved ? { kind: "saved", version: view.tutor.version } : { kind: "dirty" };
  return view.versions.length > 0 ? { kind: "submitted", version: view.tutor.version } : { kind: "idle" };
}
