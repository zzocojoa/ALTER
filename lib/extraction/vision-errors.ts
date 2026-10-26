import { privateJson } from "../owner-access";
import { isAiTransportFailure } from "../ai/retry";
import { materialErrorResponse } from "../materials/server-access";

export function visionErrorResponse(error: unknown): Response {
  if (isAiTransportFailure(error)) return privateJson({ error: error.code, stage: error.stage, providerStatus: error.status, providerCode: error.providerCode, callId: error.callId }, 502);
  if (error instanceof Error && "code" in error && typeof error.code === "string" && /^(ai_|additional_budget)/.test(error.code)) return privateJson({ error: error.code }, 503);
  return materialErrorResponse(error);
}
