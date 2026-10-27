import { z } from "zod";
import { candidateSnapshot, confirmedUnit, prerequisiteState, scopeState, sourceExcerpt } from "@/lib/librarian/contracts";
import { libraryReply } from "../materials/client-api";

export const overviewReply = z.object({ units: z.array(confirmedUnit),states: z.array(prerequisiteState),links: z.array(candidateSnapshot),history: z.array(z.object({ id: z.string().uuid(),version: z.number(),title: z.string(),date: z.string(),phase: scopeState.shape.phase })),library: libraryReply,today: z.string(),unitId: z.string().nullable() });
export const scopeViewReply = z.object({ scope: scopeState,current: z.boolean(),issue: z.string().nullable() });
export type ScopeView = Readonly<z.infer<typeof scopeViewReply>>;
export const sourcesReply = z.object({ material: libraryReply.shape.materials.element,sources: z.array(sourceExcerpt),more: z.boolean() });
export type SourcesView = Readonly<z.infer<typeof sourcesReply>>;
const failureReply = z.object({ error: z.string(),message: z.string().optional(),operation: z.string().optional() });
export class LibrarianRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message); this.name = "LibrarianRequestError"; this.status = status; this.code = code;
  }
}
export async function librarianJson(url: string, init: RequestInit): Promise<unknown> {
  const response: Response = await fetch(url, { ...init,cache: "no-store",credentials: "same-origin" });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("로그인 상태와 서버 응답을 확인해 주세요.");
  const value: unknown = await response.json();
  if (!response.ok) { const error = failureReply.parse(value); throw new LibrarianRequestError(`${error.message ?? "요청을 완료하지 못했어요. 최신 기록을 확인해 주세요."} (HTTP ${response.status} · ${error.error}${error.operation ? ` · ${error.operation}` : ""})`, response.status, error.error); }
  return value;
}
export function formText(data: FormData, key: string): string { const value = data.get(key); if (typeof value !== "string") throw new Error(`${key} 입력이 필요해요.`); return value; }
