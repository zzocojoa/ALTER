import { z } from "zod";
import { correctionInput } from "./confirmation.ts";
import { validatePageResult } from "./result.ts";
import type { PageResult } from "./result.ts";
import type { StoredExtractionPage } from "./state.ts";

export const transcriptionInput = correctionInput.extend({ intent: z.literal("transcribe"), resultId: z.string().uuid().nullable(), segments: z.array(z.object({ id: z.literal("s0"), text: z.string().max(60000).refine((text: string): boolean => text.trim().length > 0, "전사할 내용을 입력해 주세요.") }).strict()).length(1) }).strict();
export type TranscriptionInput = Readonly<z.infer<typeof transcriptionInput>>;
export type TranscriptionEntry = "create" | "edit" | "recover" | "unavailable";

/** 처리 결과가 불명확하면 이전 결과가 있어도 먼저 기존 요청을 확인합니다. */
export function transcriptionEntry(page: StoredExtractionPage): TranscriptionEntry {
  if (page.state === "running" || page.state === "unknown") return "recover";
  if (page.result !== null && page.result.status !== "failed" && (page.state === "complete" || page.state === "failed")) return "edit";
  if ((page.state === "pending" || page.state === "failed") && (page.result === null || page.result.status === "failed")) return "create";
  return "unavailable";
}

/** 위치를 추정하지 않는 첫 전사이며 원본 대조 전까지 미확인입니다. */
export function initialTranscription(value: TranscriptionInput): PageResult {
  const input: TranscriptionInput = transcriptionInput.parse(value);
  return validatePageResult({ filePage: input.filePage, method: "manual-correction", status: "complete", width: null, height: null, rotation: 0, segments: [{ id: "s0", kind: "text", text: input.segments[0].text, bounds: null, transform: null, uncertain: true, reason: "사용자가 직접 전사한 내용입니다. 원본 페이지와 다시 대조해 주세요." }], error: null, requiresConfirmation: true }, input.filePage);
}
