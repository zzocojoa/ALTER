import { z } from "zod";
import { aiSupportContract } from "./support.ts";
import { validateLearningOutput } from "./learning-contract.ts";
import type { LearningContext, LearningKind, LearningOutput } from "./learning-contract.ts";
import type { AiDelivery } from "./attempt.ts";

export type ResponseValidationInput = Pick<AiDelivery, "raw" | "status" | "providerRequestId" | "parse"> & Readonly<{ call: Readonly<{ id: string }> }>;
export type AiResponseCode = "ai_envelope_invalid" | "ai_model_mismatch" | "ai_refused" | "ai_incomplete" | "ai_provider_failed" | "ai_output_invalid" | "ai_json_invalid" | "ai_schema_invalid" | "ai_semantic_invalid" | "ai_parse_failed";
export type AiResponseFailure = Error & Readonly<{ code: AiResponseCode; callId: string; responseId: string | null; providerRequestId: string | null; status: number; detail: string | null }>;
export type ResponseFacts = Readonly<{ responseId: string | null; model: string | null; status: string | null; usage: unknown | null; providerErrorCode: string | null }>;
const record = z.record(z.unknown());
const responseId = z.string().regex(/^resp_[A-Za-z0-9_-]{1,180}$/);
const safeCode = z.string().regex(/^[a-z_]{1,100}$/);

/** usage는 출력 검증 전에 정산 경로로 전달하며 거절·불완전 응답에서도 버리지 않습니다. */
export function responseFacts(raw: unknown): ResponseFacts {
  const body: Record<string, unknown> = record.parse(raw);
  const id = responseId.safeParse(body.id);
  const error = record.safeParse(body.error);
  const code = safeCode.safeParse(error.success ? error.data.code : null);
  return { responseId: id.success ? id.data : null, model: typeof body.model === "string" ? body.model : null, status: typeof body.status === "string" ? body.status : null, usage: body.usage ?? null, providerErrorCode: code.success ? code.data : null };
}

function failure(input: ResponseValidationInput, code: AiResponseCode, detail: string | null): AiResponseFailure {
  const body = record.safeParse(input.raw);
  const id = responseId.safeParse(body.success ? body.data.id : null);
  return Object.assign(new Error("AI 응답을 확정 학습 기록으로 사용할 수 없습니다. 오류 코드와 요청 식별자를 확인하세요."), { name: "AiResponseFailure", code, callId: input.call.id, responseId: id.success ? id.data : null, providerRequestId: input.providerRequestId, status: input.status, detail });
}

/** 사용량 저장·정산 후 호출하며 실패한 제안을 학습 확정 기록으로 승격하지 않습니다. */
export async function validateAiResponse(input: ResponseValidationInput, expectedKind: LearningKind, context: LearningContext): Promise<LearningOutput> {
  const envelope = record.safeParse(input.raw);
  if (!envelope.success) throw failure(input, "ai_envelope_invalid", null);
  const facts: ResponseFacts = responseFacts(input.raw);
  if (!facts.responseId) throw failure(input, "ai_envelope_invalid", "response_id");
  if (facts.model !== aiSupportContract.model) throw failure(input, "ai_model_mismatch", null);
  if (facts.status === "incomplete" || facts.status === "in_progress" || facts.status === "queued" || facts.status === "cancelled") throw failure(input, "ai_incomplete", facts.status);
  if (facts.status === "failed") throw failure(input, "ai_provider_failed", facts.providerErrorCode);
  if (facts.status !== "completed" || !Array.isArray(envelope.data.output)) throw failure(input, "ai_envelope_invalid", "status_or_output");
  for (const item of envelope.data.output as unknown[]) {
    const output = record.safeParse(item);
    if (!output.success || !["message", "reasoning"].includes(String(output.data.type))) throw failure(input, "ai_output_invalid", "unexpected_output_item");
    if (output.data.type !== "message") continue;
    if (!Array.isArray(output.data.content)) throw failure(input, "ai_output_invalid", "message_content");
    for (const value of output.data.content as unknown[]) {
      const content = record.safeParse(value);
      if (content.success && content.data.type === "refusal") throw failure(input, "ai_refused", null);
      if (!content.success || content.data.type !== "output_text") throw failure(input, "ai_output_invalid", "message_content_type");
    }
  }
  let parsed: LearningOutput;
  try { parsed = await input.parse(); }
  catch (error: unknown) {
    if (error instanceof z.ZodError) throw failure(input, "ai_schema_invalid", null);
    if (error instanceof SyntaxError) throw failure(input, "ai_json_invalid", null);
    throw failure(input, "ai_parse_failed", error instanceof Error ? error.name : "unknown");
  }
  try { return validateLearningOutput(parsed, expectedKind, context); }
  catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ai_semantic_invalid" && "rule" in error && typeof error.rule === "string") throw failure(input, "ai_semantic_invalid", error.rule);
    if (error instanceof z.ZodError) throw failure(input, "ai_schema_invalid", null);
    throw error;
  }
}

/** 제공사가 반영한 출력 제한을 저장된 요청 상한과 대조합니다. */
export function requireAiOutputLimit(raw: unknown, expected: number): void {
  const envelope = z.object({ max_output_tokens: z.number().int() }).passthrough().parse(raw);
  if (envelope.max_output_tokens !== expected) throw Object.assign(new Error("제공사 응답의 출력 제한이 요청과 다릅니다."), { code: "ai_output_limit_unverified" });
}
