import { getTutor } from "../../db/repositories/tutor.ts";
import { domainFailure } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import type { AiRunOutcome, AiRunRuntime } from "../ai/run.ts";
import type { PricingVersion } from "../ai/pricing.ts";
import type { ModelRequest } from "../ai/request-bound.ts";
import { processTutorAi } from "./ai.ts";
import type { TutorDispatcher } from "./ai.ts";
import type { TutorState } from "./contracts.ts";

const rejectNewGeneration: TutorDispatcher = async (): Promise<AiRunOutcome> => {
  throw domainFailure("result_unknown", "tutor.recovery-existing-request-required", null);
};

/** 저장된 응답만 복구하며 요청 기록이 없을 때 생성·비용 예약으로 전환하지 않습니다. */
export async function recoverStoredTutorAi(runtime: AiRunRuntime, bucket: R2Bucket, owner: SiteIdentity, id: string, pricing: PricingVersion, request: ModelRequest, signal: AbortSignal): Promise<TutorState> {
  const state: TutorState = await getTutor(runtime.db, owner, id);
  if (!state.pending) throw domainFailure("reference_conflict", "tutor.recovery-no-pending-request", null);
  return processTutorAi(runtime, bucket, owner, id, pricing, request, rejectNewGeneration, signal);
}
