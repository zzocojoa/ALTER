import { z } from "zod";
export type BackupBrowserRequest = Readonly<{ fetch: typeof fetch; signal: AbortSignal }>;
/** 인증·동일 출처 정책을 유지하며 실패 응답을 숨기지 않습니다. 재개는 동일 작업 ID로 명시적으로 실행합니다. */
export async function backupBrowserRequest(runtime: BackupBrowserRequest, url: string, init: RequestInit): Promise<unknown> {
  const result = await runtime.fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: runtime.signal });
  const text: string = await result.text(); let value: unknown;
  try { value = JSON.parse(text); } catch (error: unknown) { if (!(error instanceof SyntaxError)) throw error; throw new Error(`서버 응답 형식이 올바르지 않습니다 (${result.status} · ${url}). 작업 상태를 확인해 주세요.`); }
  if (!result.ok) { const detail = z.object({ error: z.string(), operation: z.string().optional(), field: z.string().optional(), location: z.string().optional(), message: z.string().optional() }).passthrough().parse(value); throw new Error(`${detail.message ?? "백업·복원 요청을 마치지 못했습니다."} (${result.status} · ${url} · ${detail.error} · ${detail.field ?? detail.location ?? detail.operation ?? ""})`); }
  return value;
}
export function backupBrowserPost(runtime: BackupBrowserRequest, url: string, body: unknown): Promise<unknown> { return backupBrowserRequest(runtime, url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
