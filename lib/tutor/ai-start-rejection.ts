import { z } from "zod";
import { recordId, version } from "../domain/contracts.ts";

export const aiStartAction = z.enum(["lesson", "diagnose", "help", "variation", "feedback", "review"]);
export type AiStartAction = z.infer<typeof aiStartAction>;
export const aiStartRejection = z.object({ status: z.literal("not-started"), key: recordId, id: recordId, expectedVersion: version, action: aiStartAction }).strict();
export type AiStartRejection = Readonly<z.infer<typeof aiStartRejection>>;
type StartIntent = Readonly<{ key: string; input: Readonly<{ id: string; expectedVersion: number; action: string }> }>;
/** 다른 회차·버전·동작·요청 키의 거부가 현재 전송 잠금을 풀지 못하게 합니다. */
export function matchesAiStartRejection(value: unknown, intent: StartIntent): boolean {
  const parsed = aiStartRejection.safeParse(value);
  return parsed.success && parsed.data.key === intent.key && parsed.data.id === intent.input.id && parsed.data.expectedVersion === intent.input.expectedVersion && parsed.data.action === intent.input.action;
}
