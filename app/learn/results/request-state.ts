import { z } from "zod";
import { canonicalJson, recordId } from "@/lib/domain/contracts";
import { resultRequest, type ResultDraft } from "@/lib/results/contracts";

export const resultIntent = z.object({ key: recordId, input: resultRequest }).strict();
export type ResultIntent = Readonly<z.infer<typeof resultIntent>>;
export function readResultIntent(id: string): ResultIntent | null {
  const value: string | null = sessionStorage.getItem(`alter:result-confirmation:${id}`);
  if (value === null) return null;
  const intent = resultIntent.parse(JSON.parse(value));
  if (intent.input.id !== id) throw new Error("다른 회차의 확정 요청 식별자가 보관되어 있어요.");
  return intent;
}
export function saveResultIntent(intent: ResultIntent): void { sessionStorage.setItem(`alter:result-confirmation:${intent.input.id}`, JSON.stringify(resultIntent.parse(intent))); }
export function clearResultIntent(id: string): void { sessionStorage.removeItem(`alter:result-confirmation:${id}`); }
/** 오래된 조회와 다른 회차의 확정 결과를 현재 기록으로 적용하지 않습니다. */
export function requireResultResponse(previous: ResultDraft, next: ResultDraft): void {
  if (next.id !== previous.id) throw new Error("다른 회차의 결과 응답을 적용하지 않았어요. 서버 최신 기록을 다시 확인해 주세요.");
  if (next.version < previous.version || next.sessionVersion < previous.sessionVersion || next.officialVersion < previous.officialVersion) throw new Error("과거 버전의 결과 응답을 적용하지 않았어요. 서버 최신 기록을 다시 확인해 주세요.");
  if (previous.confirmation && canonicalJson(previous.confirmation) !== canonicalJson(next.confirmation)) throw new Error("보존된 확정 이력과 응답이 달라요. 이전 확정본을 유지했어요.");
}
