import { preserveAiUnknown, settleAiUsage, storeAiEvidence, storeAiInvalid, storeAiValidated } from "../../db/repositories/ai-settlement.ts";
import type { AiSettlement } from "../../db/repositories/ai-settlement.ts";
import { domainFailure } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import type { AiDelivery } from "./attempt.ts";
import type { LearningContext, LearningKind, LearningOutput } from "./learning-contract.ts";
import { responseFacts, validateAiResponse } from "./response.ts";
import type { ResponseFacts } from "./response.ts";

export type CompletionRuntime = Readonly<{ db: D1Database; now: () => number; loadContext: (owner: SiteIdentity) => Promise<LearningContext> }>;
/** 사용량 저장·정산이 끝난 다음 최신 서버 학습 상태로 검증하며 사용자 확정은 별도입니다. */
export async function completeAiDelivery(runtime: CompletionRuntime, delivery: AiDelivery, expectedKind: LearningKind): Promise<LearningOutput> {
  let facts: ResponseFacts;
  try { facts = responseFacts(delivery.raw); }
  catch (error: unknown) {
    await preserveAiUnknown(runtime.db, delivery.owner, delivery.call.id, "ai_envelope_invalid", runtime.now());
    throw error;
  }
  await storeAiEvidence(runtime.db, delivery.owner, delivery.call.id, { facts, providerRequestId: delivery.providerRequestId, httpStatus: delivery.status });
  const settlement: AiSettlement = await settleAiUsage(runtime.db, delivery.owner, delivery.call.id, runtime.now());
  if (settlement.state !== "settled") throw domainFailure("result_unknown", `ai.cost.${settlement.state}`, null);
  let output: LearningOutput;
  try { output = await validateAiResponse(delivery, expectedKind, await runtime.loadContext(delivery.owner)); }
  catch (error: unknown) {
    if (error instanceof Error && "code" in error && typeof error.code === "string" && /^ai_[a-z_]+$/.test(error.code)) await storeAiInvalid(runtime.db, delivery.owner, delivery.call.id, error.code);
    throw error;
  }
  await storeAiValidated(runtime.db, delivery.owner, delivery.call.id, output);
  return output;
}
