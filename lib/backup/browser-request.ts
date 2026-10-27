import { z } from "zod";
export type BackupBrowserRequest = Readonly<{ fetch: typeof fetch; signal: AbortSignal }>;

/** 서버 원문은 오류 근거에만 보관하고 화면 메시지에 인증정보를 포함하지 않습니다. */
export class BackupResponseError extends Error {
  constructor(readonly status: number, readonly endpoint: string, readonly responseBody: unknown) {
    super(status === 401 ? "로그인이 만료되었어요 (HTTP 401). 다시 로그인한 뒤 같은 작업을 확인해 주세요." : status === 403 ? "이 작업의 소유자 권한이 없어요 (HTTP 403). 소유자 계정으로 다시 확인해 주세요." : `백업·복원 요청을 마치지 못했어요 (HTTP ${status}). 같은 작업 ID로 상태를 확인해 주세요.`);
    this.name = "BackupResponseError";
  }
}
export async function requireBackupResponse(result: Response, url: string): Promise<Response> {
  if (result.ok) return result;
  const body: string = await result.text();
  throw new BackupResponseError(result.status, url, body);
}
/** 인증·동일 출처 정책을 유지합니다. 재개는 동일 작업 ID로 명시적으로 실행합니다. */
export async function backupBrowserRequest(runtime: BackupBrowserRequest, url: string, init: RequestInit): Promise<unknown> {
  const result = await requireBackupResponse(await runtime.fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: runtime.signal }), url);
  const text: string = await result.text();
  try { return JSON.parse(text) as unknown; } catch (error: unknown) { if (!(error instanceof SyntaxError)) throw error; throw new Error(`서버 응답 형식이 올바르지 않습니다 (HTTP ${result.status}). 같은 작업 ID로 상태를 확인해 주세요.`); }
}
export function backupBrowserPost(runtime: BackupBrowserRequest, url: string, body: unknown): Promise<unknown> { return backupBrowserRequest(runtime, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

/** 사용자 파일과 서버 응답의 파싱 오류는 원문을 노출하지 않고 다음 행동으로 설명합니다. */
export function backupFailureMessage(failure: unknown): string {
  if (failure instanceof z.ZodError || failure instanceof SyntaxError) return "백업 ID·파일·서버 응답의 형식이 올바르지 않아요. 선택한 파일과 같은 작업의 상태를 확인해 주세요.";
  if (failure instanceof DOMException && failure.name === "AbortError") return "수신을 중단했어요. 완료로 처리하지 않았으며 같은 작업 ID로 이어갈 수 있어요.";
  if (failure instanceof DOMException && failure.name === "NotFoundError") return "브라우저에 받은 파일이 없어요. 같은 백업을 받았던 브라우저에서 다시 확인하거나 새 백업을 준비해 주세요.";
  if (failure instanceof TypeError) return "요청을 마치지 못했어요. 네트워크 연결을 확인하고 같은 작업 ID로 결과를 다시 확인해 주세요.";
  if (failure instanceof Error) return failure.message;
  return "예상하지 못한 오류로 작업을 마치지 못했어요. 새 작업을 만들기 전에 같은 작업 ID로 상태를 확인해 주세요.";
}
