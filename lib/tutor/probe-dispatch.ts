import { executeAiAttempt } from "../ai/attempt.ts";
import { runAiAttemptSequence } from "../ai/run.ts";
import { requireDispatchPricing } from "../ai/pricing.ts";
import type { ModelRequest, PreparedAiRequest } from "../ai/request-bound.ts";
import { domainFailure } from "../domain/contracts.ts";
import type { TutorDispatcher } from "./ai.ts";
import type { TutorState } from "./contracts.ts";

export type TutorProbeVerifier = (request: ModelRequest, now: number) => Promise<PreparedAiRequest>;
/** 승인된 진단도 원래의 소유자·출처·비용 원장과 재시도 검사를 그대로 거칩니다. */
export function createTutorProbeDispatcher(state: TutorState, verify: TutorProbeVerifier): TutorDispatcher {
  return async (runtime, input, signal) => {
    if (input.pricing.purpose !== "prepaid-probe" || input.expectedKind !== "tutor-diagnosis" || input.logicalRequestKey !== state.pending?.key) throw domainFailure("reference_conflict", "tutor.approved-probe-dispatch", null);
    requireDispatchPricing(input.pricing, runtime.now());
    const prepared: PreparedAiRequest = await verify(input.request, runtime.now());
    const owner = await runtime.authenticate();
    await runtime.requireSupport(owner, prepared, runtime.now());
    return runAiAttemptSequence({ ...runtime, authorizeSources: async (identity, actual): Promise<void> => {
      await verify(actual.request, runtime.now());
      await runtime.authorizeSources(identity, actual);
    } }, input, executeAiAttempt, signal);
  };
}
