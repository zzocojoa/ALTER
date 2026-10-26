import { describe, expect, it } from "vitest";
import { calculateRequestBound, countEvidence, exceedsReservation, prepareAiRequest, prepareAiStreamingRequest, tokenCountPayload, verifyRequestBound } from "../../lib/ai/request-bound";
import type { CountEvidence, ModelRequest, PreparedAiRequest } from "../../lib/ai/request-bound";
import { fixturePricing } from "../fixtures/ai-pricing";
import { calculateUsageCost } from "../../lib/ai/pricing";
import { recordId } from "../../lib/domain/contracts";

const request: ModelRequest = { instructions: "허용된 자료만 설명", messages: [{ role: "user", content: [{ type: "input_text", text: "질문" }] }], maximumOutputTokens: 64, reasoningEffort: "none" };
const image = { type: "input_image", sourceRefId: recordId.parse("00000000-0000-4000-8000-000000000001"), dataUrl: "data:image/png;base64,AQID", width: 1, height: 1, bytes: 3, detail: "low" } as const;
function evidence(prepared: PreparedAiRequest, tokens: number): CountEvidence { return countEvidence.parse({ requestFingerprint: prepared.requestFingerprint, model: "gpt-6-luna", inputTokens: tokens, providerRequestId: "req_mock_count", checkedAt: 150 }); }

describe("요청 전체의 비용 상한", (): void => {
  it("지시문·대화·이미지·출력 스키마를 동일한 입력으로 집계한다", async (): Promise<void> => {
    const prepared = await prepareAiRequest({ ...request, messages: [{ role: "user", content: [request.messages[0].content[0], image, { ...image, width: 8192, height: 8192, detail: "high" }] }] });
    const count = tokenCountPayload(prepared);
    expect(count.input).toEqual(prepared.body.input);
    expect(count.instructions).toEqual(prepared.body.instructions);
    expect(count.text).toEqual(prepared.body.text);
    expect(count.reasoning).toEqual(prepared.body.reasoning);
    expect(prepared.body.tools).toEqual([]);
    expect(prepared.body.tool_choice).toBe("none");
    expect(prepared.body.service_tier).toBe("default");
    const bound = await calculateRequestBound(prepared, evidence(prepared, 2000), fixturePricing(), 150);
    expect(bound.imageCount).toBe(2); expect(bound.imageBytes).toBe(6); expect(bound.inputTokenBound).toBe(2000); expect(bound.reasoningIncluded).toBe(true);
    await expect(verifyRequestBound(prepared, bound, fixturePricing())).resolves.toBeUndefined();
  });
  it("이미지 해상도·detail·본문·출력 제한 변경은 기존 상한을 재사용하지 못한다", async (): Promise<void> => {
    const prepared = await prepareAiRequest({ ...request, messages: [{ role: "user", content: [image] }] });
    const bound = await calculateRequestBound(prepared, evidence(prepared, 2000), fixturePricing(), 150);
    for (const changed of [{ ...request, maximumOutputTokens: 128 }, { ...request, instructions: "다른 지시" }, { ...request, messages: [{ role: "user" as const, content: [{ ...image, detail: "high" as const }] }] }, { ...request, messages: [{ role: "user" as const, content: [{ ...image, width: 2 }] }] }]) {
      const next = await prepareAiRequest(changed);
      await expect(calculateRequestBound(next, evidence(prepared, 2000), fixturePricing(), 150)).rejects.toMatchObject({ code: "ai_bound_unavailable" });
      await expect(verifyRequestBound(next, bound, fixturePricing())).rejects.toMatchObject({ code: "ai_bound_unavailable" });
    }
  });
  it("집계 없음·다른 모델·오래된 집계·지원되지 않는 이미지 조건은 차단한다", async (): Promise<void> => {
    const prepared = await prepareAiRequest(request);
    expect(countEvidence.safeParse({ ...evidence(prepared, 100), inputTokens: undefined }).success).toBe(false);
    expect(countEvidence.safeParse({ ...evidence(prepared, 100), model: "other" }).success).toBe(false);
    await expect(calculateRequestBound(prepared, { ...evidence(prepared, 100), checkedAt: 151 }, fixturePricing(), 150)).rejects.toMatchObject({ field: "token-count.expired" });
    for (const changed of [{ ...image, detail: "unknown" }, { ...image, dataUrl: "https://example.test/image.png" }, { ...image, width: 8193 }, { ...image, bytes: 4 }]) await expect(prepareAiRequest({ ...request, messages: [{ role: "user", content: [changed] }] } as unknown as ModelRequest)).rejects.toThrow();
  });
  it("긴 대화와 누락된 출력 제한은 잘라서 우회하지 않는다", async (): Promise<void> => {
    await expect(prepareAiRequest({ ...request, maximumOutputTokens: undefined } as unknown as ModelRequest)).rejects.toThrow();
    await expect(prepareAiRequest({ ...request, messages: Array(60).fill({ role: "user", content: [{ type: "input_text", text: "x".repeat(200_000) }] }) })).rejects.toMatchObject({ field: "request.bytes" });
    await expect(prepareAiRequest({ ...request, messages: [{ role: "user", content: Array(5).fill(image) }] })).rejects.toMatchObject({ field: "image.request-limit" });
  });
  it("상한 계산 후 본문·단가·금액을 변경하면 전송을 거부한다", async (): Promise<void> => {
    const prepared = await prepareAiRequest(request);
    const pricing = fixturePricing();
    const bound = await calculateRequestBound(prepared, evidence(prepared, 100), pricing, 150);
    await expect(verifyRequestBound({ ...prepared, body: { ...prepared.body, instructions: "mutated" } }, bound, pricing)).rejects.toMatchObject({ field: "reservation.fingerprint" });
    await expect(verifyRequestBound(prepared, { ...bound, amount: { ...bound.amount, units: 0 } }, pricing)).rejects.toMatchObject({ field: "reservation.amount" });
    await expect(verifyRequestBound(prepared, bound, { ...pricing, exchange: { ...pricing.exchange, krwPerUsd: "1001" } })).rejects.toMatchObject({ code: "ai_bound_unavailable" });
  });
  it("스트림 전송 방식까지 예약 지문에 포함하고 변조를 거부한다", async (): Promise<void> => {
    const plain = await prepareAiRequest(request);
    const streamed = await prepareAiStreamingRequest(request);
    expect(streamed.requestFingerprint).not.toBe(plain.requestFingerprint);
    expect(tokenCountPayload(streamed)).toEqual(tokenCountPayload(plain));
    const bound = await calculateRequestBound(streamed, evidence(streamed, 100), fixturePricing(), 150);
    await expect(verifyRequestBound(streamed, bound, fixturePricing())).resolves.toBeUndefined();
    await expect(verifyRequestBound(plain, bound, fixturePricing())).rejects.toMatchObject({ code: "ai_bound_unavailable" });
    await expect(calculateRequestBound({ ...streamed, body: { ...streamed.body, instructions: "변조" } }, evidence(streamed, 100), fixturePricing(), 150)).rejects.toMatchObject({ code: "ai_bound_unavailable" });
  });
  it("실제 사용량이 상한을 넘으면 금액을 줄이지 않고 이상 상태로 식별한다", async (): Promise<void> => {
    const prepared = await prepareAiRequest(request);
    const pricing = fixturePricing();
    const bound = await calculateRequestBound(prepared, evidence(prepared, 100), pricing, 150);
    const actual = calculateUsageCost({ inputTokens: 1000, cachedInputTokens: 0, cacheWriteTokens: 0, cacheWriteTtl: "30m", outputTokens: 1000, reasoningTokens: 500, totalTokens: 2000 }, pricing, 150);
    const previous: number = actual.units;
    expect(exceedsReservation(actual, bound)).toBe(true);
    expect(actual.units).toBe(previous);
  });
});
