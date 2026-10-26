import { describe, expect, it } from "vitest";
import { decideAiRetry } from "../../lib/ai/retry.ts";
import type { AiTransportFailure } from "../../lib/ai/attempt.ts";

function error(): AiTransportFailure {
  return Object.assign(new Error("검사 오류"), { code: "ai_transport_failed" as const, stage: "response" as const, category: "http" as const, status: 429, providerCode: null, providerParam: null, providerRequestId: null, retryAfter: null, callId: null, owner: { realm: "sites" as const, userId: "test" }, reservationId: null });
}
describe("명시적 AI 재시도", () => {
  it("네트워크·429·5xx만 최대 세 번 실행한다", () => {
    expect(decideAiRetry(error(), 1, 0)).toEqual({ retry: true, delayMs: 1000 });
    expect(decideAiRetry({ ...error(), category: "network", status: null }, 2, 0)).toEqual({ retry: true, delayMs: 2000 });
    expect(decideAiRetry({ ...error(), status: 503 }, 3, 0).retry).toBe(false);
    for (const status of [400, 401, 403, 404]) expect(decideAiRetry({ ...error(), status }, 1, 0).retry).toBe(false);
    expect(decideAiRetry({ ...error(), providerCode: "insufficient_quota" }, 1, 0).retry).toBe(false);
    expect(decideAiRetry({ ...error(), category: "cancelled" }, 1, 0).retry).toBe(false);
  });
  it("Retry-After를 존중하고 30초보다 긴 대기는 중단한다", () => {
    expect(decideAiRetry({ ...error(), retryAfter: "2.5" }, 1, 0)).toEqual({ retry: true, delayMs: 2500 });
    expect(decideAiRetry({ ...error(), retryAfter: "Thu, 01 Jan 1970 00:00:05 GMT" }, 1, 0)).toEqual({ retry: true, delayMs: 5000 });
    expect(decideAiRetry({ ...error(), retryAfter: "31" }, 1, 0)).toEqual({ retry: false, reason: "retry-after-too-long" });
    expect(decideAiRetry({ ...error(), retryAfter: "invalid" }, 1, 0)).toEqual({ retry: false, reason: "retry-after-invalid" });
  });
});
