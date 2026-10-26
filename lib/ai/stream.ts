import OpenAI from "openai";
import { isDomainFailure } from "../../db/repositories/atomic.ts";
import { parseResponse } from "openai/lib/ResponsesParser";
import type { Response as ModelResponse } from "openai/resources/responses/responses";
import { reserveAiDispatch, transportFailure } from "./attempt.ts";
import type { AttemptRuntime, AiAttemptInput, AiAttemptOutcome } from "./attempt.ts";
import { prepareAiStreamingRequest } from "./request-bound.ts";
import { learningOutput } from "./learning-contract.ts";
import type { LearningOutput } from "./learning-contract.ts";
import { responseFacts } from "./response.ts";
import { preserveAiUnknown, storeAiEvidence, storeAiTransportEvidence } from "../../db/repositories/ai-settlement.ts";

type CreatedObserver = () => void;

/** 응답 생성 이벤트의 ID를 먼저 영속화하여 연결 중단 뒤 조회로 복구할 근거를 남깁니다. */
async function receiveAiStream(runtime: AttemptRuntime, input: AiAttemptInput, signal: AbortSignal, onCreated: CreatedObserver): Promise<AiAttemptOutcome> {
  const prepared = await prepareAiStreamingRequest(input.request);
  const reserved = await reserveAiDispatch(runtime, input, prepared, signal);
  if (reserved.kind === "existing") return reserved;
  const { owner, call, client, bound } = reserved;
  if (prepared.body.stream !== true) throw new Error("스트림 전송 본문이 필요합니다.");
  let status: number | null = null;
  let requestId: string | null = null;
  try {
    const received = await client.responses.create(prepared.body, { signal, maxRetries: 0, headers: { "X-Client-Request-Id": call.id } }).withResponse();
    status = received.response.status; requestId = received.request_id;
    let completed: ModelResponse | null = null;
    for await (const event of received.data) {
      if (event.type === "response.created") {
        const facts = responseFacts(event.response);
        if (!facts.responseId) throw new Error("스트림 생성 이벤트에 응답 식별자가 없습니다.");
        await storeAiEvidence(runtime.db, owner, call.id, { facts, providerRequestId: requestId, httpStatus: status });
        onCreated();
        if (signal.aborted) { received.data.controller.abort(); throw new OpenAI.APIUserAbortError(); }
      }
      if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
        completed = event.response;
        await storeAiEvidence(runtime.db, owner, call.id, { facts: responseFacts(completed), providerRequestId: requestId, httpStatus: status });
        break;
      }
    }
    if (completed === null) {
      if (signal.aborted) throw new OpenAI.APIUserAbortError();
      throw new Error("스트림이 최종 응답과 사용량을 전달하지 않고 종료되었습니다.");
    }
    const raw: ModelResponse = completed;
    return { kind: "received", owner, call, intent: reserved.intent, bound, raw, status, providerRequestId: requestId,
      parse: async (): Promise<LearningOutput> => learningOutput.parse(parseResponse(raw, prepared.body).output_parsed) };
  } catch (error: unknown) {
    if (isDomainFailure(error)) throw error;
    const failure = transportFailure(error, "response", owner, call.id);
    await storeAiTransportEvidence(runtime.db, owner, call.id, status ?? failure.status, requestId ?? failure.providerRequestId);
    await preserveAiUnknown(runtime.db, owner, call.id, "ai_transport_failed", runtime.now());
    throw failure;
  }
}

/** 최종 이벤트의 usage를 공통 정산 경로로 전달하며 브라우저에 미검증 출력을 전달하지 않습니다. */
export async function executeAiStreamAttempt(runtime: AttemptRuntime, input: AiAttemptInput, signal: AbortSignal): Promise<AiAttemptOutcome> {
  return receiveAiStream(runtime, input, signal, (): void => {});
}

/** 실제 연결 중단 검사는 응답 ID 저장 직후 취소하고 미정산 예약을 보존합니다. */
export async function executeInterruptedAiStreamAttempt(runtime: AttemptRuntime, input: AiAttemptInput, signal: AbortSignal): Promise<AiAttemptOutcome> {
  const cancellation: AbortController = new AbortController();
  return receiveAiStream(runtime, input, AbortSignal.any([signal, cancellation.signal]), (): void => cancellation.abort());
}
