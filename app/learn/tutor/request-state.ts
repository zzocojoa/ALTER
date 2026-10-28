import type { SaveState } from "@/lib/ui/save-status";
import type { TutorAction } from "@/lib/tutor/request";
import type { TutorView } from "@/lib/tutor/view";
import { LibrarianRequestError } from "../library/client-api";

export type TutorWriteFailure = Readonly<{ kind: "error" | "unknown" | "conflict"; detail: string }>;
export type PendingTutorRequest = Readonly<{ body: string; key: string; input: TutorAction }>;
export type TutorSaveContext = Readonly<{ view: TutorView; saved: boolean; text: string; fileCount: number; action: TutorAction["action"] | null; failure: TutorWriteFailure | null }>;

/** 전송 실패와 서버의 명시적 거부를 구분하며 응답 유실은 성공으로 추정하지 않습니다. */
export function tutorWriteFailure(cause: Error): TutorWriteFailure {
  if (cause instanceof LibrarianRequestError && cause.status === 409) return { kind: "conflict", detail: cause.message };
  if (cause instanceof LibrarianRequestError && cause.status >= 400 && cause.status < 500) return { kind: "error", detail: cause.message };
  return { kind: "unknown", detail: `${cause.message} 현재 입력을 유지했어요. 최신 기록을 읽거나 같은 요청을 다시 확인해 주세요.` };
}

/** 재조회는 동일한 답안 ID 또는 동일한 초안 내용이 확인될 때만 미확정 저장을 해소합니다. */
export function observedTutorWrite(input: TutorAction, view: TutorView): boolean {
  if (input.id !== view.id) return false;
  if (input.action === "draft") return JSON.stringify(input.draft) === JSON.stringify(view.draft);
  if (input.action === "submit") return view.answers.some((answer): boolean => answer.id === input.answerId && answer.text === input.draft.text && JSON.stringify(answer.fileIds) === JSON.stringify(input.draft.fileIds));
  return false;
}

export function tutorSaveState({ view, saved, text, fileCount, action, failure }: TutorSaveContext): SaveState {
  if (view.phase !== "awaiting-answer" && view.answers.length > 0) return { kind: "submitted", version: view.version };
  if (failure) return failure;
  if (action === "draft") return { kind: "saving" };
  if (!saved) return { kind: "dirty" };
  return text.length > 0 || fileCount > 0 ? { kind: "saved", version: view.version } : { kind: "idle" };
}

/** 요청한 회차와 현재 버전보다 오래된 응답을 입력에 적용하지 않습니다. */
export function requireTutorResponse(id: string, previous: TutorView | null, next: TutorView): void {
  if (next.id !== id) throw Object.assign(new Error(`요청한 수업과 다른 기록이 반환됐어요. 현재 입력은 유지했어요. 요청 ${id} · 응답 ${next.id}`), { name: "TutorResponseMismatchError" });
  if (previous?.id === id && next.version < previous.version) throw Object.assign(new Error(`이전 수업 버전이 반환됐어요. 현재 입력은 유지했어요. 수업 ${id} · 현재 ${previous.version}판 · 응답 ${next.version}판`), { name: "TutorResponseMismatchError" });
}
