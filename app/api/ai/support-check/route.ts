import { z } from "zod";
import { ownerRejection, privateJson } from "@/lib/owner-access";
import { mutationRejection } from "@/lib/request-security";
import { checkOwnerAiSupport } from "@/lib/ai/server";
import { isAiTransportFailure } from "@/lib/ai/retry";
import { isDomainFailure } from "@/db/repositories/atomic";

/** 빈 POST도 ReadableStream으로 전달하는 런타임에서 실제 바이트 유무만 확인합니다. */
async function hasRequestBody(request: Request): Promise<boolean> {
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = request.body?.getReader();
  if (!reader) return false;
  try {
    for (;;) {
      const part: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (part.done) return false;
      if (part.value.byteLength > 0) { await reader.cancel(); return true; }
    }
  } finally { reader.releaseLock(); }
}

/** 요청 본문의 모델·자료·설정은 받지 않고 소유자의 고정 검사만 실행합니다. */
export async function POST(request: Request): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection !== null) return rejection;
  const originRejection: Response | null = mutationRejection(request.headers.get("origin"));
  if (originRejection !== null) return originRejection;
  if (await hasRequestBody(request)) return privateJson({ error: "ai_probe_body_not_allowed" }, 400);
  try { return privateJson(await checkOwnerAiSupport(request.signal), 200); }
  catch (error: unknown) {
    if (error instanceof Error && error.name === "RestoreExecutionFailure") return privateJson({ error: "restore_execution_unverified", message: error.message }, 423);
    if (error instanceof Error && "code" in error && error.code === "ai_key_mismatch") {
      const diagnostics = Object.fromEntries(Object.entries(error).filter(([key, value]): boolean => ["code", "hasWhitespace", "hasAssignmentPrefix", "hasQuotes", "hasProjectKeyPrefix"].includes(key) && (typeof value === "boolean" || typeof value === "string")));
      return privateJson({ error: "ai_key_mismatch", ...diagnostics }, 503);
    }
    if (error instanceof Error && "code" in error && typeof error.code === "string" && ["ai_configuration_required", "ai_key_required", "ai_pricing_invalid", "ai_funding_unverified", "ai_credit_required", "additional_budget_exceeded"].includes(error.code)) return privateJson({ error: error.code }, 503);
    if (error instanceof z.ZodError) return privateJson({ error: "ai_probe_configuration_or_response_invalid" }, 422);
    if (isAiTransportFailure(error)) {
      const diagnostic = { error: error.code, stage: error.stage, category: error.category, providerStatus: error.status, providerCode: error.providerCode, providerParam: error.providerParam, callId: error.callId, providerRequestId: error.providerRequestId };
      console.warn({ event: "ai_support_probe_failed", ...diagnostic });
      return privateJson(diagnostic, 502);
    }
    if (isDomainFailure(error)) return privateJson({ error: error.code, operation: error.operation }, 409);
    throw error;
  }
}
