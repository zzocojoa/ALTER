import { describe, expect, it } from "vitest";
import { normalizeAiUsage } from "../../lib/ai/usage";
import { learningOutput } from "../../lib/ai/learning-contract";
import type { LearningOutput } from "../../lib/ai/learning-contract";
import { responseFacts, validateAiResponse } from "../../lib/ai/response";
import type { ResponseValidationInput } from "../../lib/ai/response";
import { emptyLearningContext } from "../fixtures/ai-learning-context";

const usage = { input_tokens: 12, output_tokens: 4, total_tokens: 16, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens_details: { reasoning_tokens: 1 } };
const good = { result: { kind: "diagnostic-question", question: "설명해 주세요.", waitForAnswer: true } };
const raw = { id: "resp_fixture", model: "gpt-6-luna", status: "completed", usage, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(good) }] }] };
function input(value: unknown, parse: () => Promise<LearningOutput>): ResponseValidationInput { return { raw: value, call: { id: "00000000-0000-4000-8000-000000000001" }, status: 200, providerRequestId: "req_fixture", parse }; }
async function parseGood(): Promise<LearningOutput> { return learningOutput.parse(good); }

describe("정산과 분리된 응답 검증", (): void => {
  it("정상 구조화 결과만 반환한다", async (): Promise<void> => { expect(await validateAiResponse(input(raw, parseGood), "diagnostic-question", emptyLearningContext())).toEqual(good); });
  it("거절·불완전·제공사 실패를 구분하고 파싱하지 않는다", async (): Promise<void> => {
    let parsed: number = 0;
    const parse = async (): Promise<LearningOutput> => { parsed += 1; return parseGood(); };
    const cases: readonly [object, string][] = [[{ ...raw, status: "incomplete" }, "ai_incomplete"], [{ ...raw, status: "failed", error: { code: "server_error", message: "개인 학습 원문" } }, "ai_provider_failed"], [{ ...raw, output: [{ type: "message", content: [{ type: "refusal", refusal: "개인 학습 원문" }] }] }, "ai_refused"]];
    for (const [value, code] of cases) {
      await expect(validateAiResponse(input(value, parse), "diagnostic-question", emptyLearningContext())).rejects.toMatchObject({ code });
      expect(responseFacts(value).usage).toEqual(usage);
    }
    expect(parsed).toBe(0);
  });
  it("JSON·Zod 오류 뒤에도 응답 식별자와 usage가 남는다", async (): Promise<void> => {
    const invalidJson = async (): Promise<LearningOutput> => JSON.parse("invalid-json");
    const invalidSchema = async (): Promise<LearningOutput> => learningOutput.parse({ result: { kind: "diagnostic-question", question: "개인 학습 원문" } });
    for (const [parse, code] of [[invalidJson, "ai_json_invalid"], [invalidSchema, "ai_schema_invalid"]] as const) {
      const before: string = JSON.stringify(raw);
      await expect(validateAiResponse(input(raw, parse), "diagnostic-question", emptyLearningContext())).rejects.toMatchObject({ code, responseId: "resp_fixture", providerRequestId: "req_fixture" });
      expect(JSON.stringify(raw)).toBe(before); expect(responseFacts(raw).usage).toEqual(usage);
    }
  });
  it("다른 모델·실행 도구·잘못된 외피를 거부한다", async (): Promise<void> => {
    await expect(validateAiResponse(input({ ...raw, model: "other" }, parseGood), "diagnostic-question", emptyLearningContext())).rejects.toMatchObject({ code: "ai_model_mismatch" });
    await expect(validateAiResponse(input({ ...raw, output: [{ type: "function_call", name: "database_write" }] }, parseGood), "diagnostic-question", emptyLearningContext())).rejects.toMatchObject({ code: "ai_output_invalid" });
    await expect(validateAiResponse(input(null, parseGood), "diagnostic-question", emptyLearningContext())).rejects.toMatchObject({ code: "ai_envelope_invalid" });
  });
  it("의미 검증 실패를 확정하지 않고 원문을 오류에 담지 않는다", async (): Promise<void> => {
    const parse = async (): Promise<LearningOutput> => learningOutput.parse({ result: { kind: "tutor-help", stage: "full-explanation", content: "개인 학습 원문", sourceRefIds: [], waitForAnswer: true } });
    try { await validateAiResponse(input(raw, parse), "tutor-help", emptyLearningContext()); throw new Error("거부되지 않았습니다."); }
    catch (error: unknown) { expect(error).toMatchObject({ code: "ai_semantic_invalid", detail: "help_order" }); expect(JSON.stringify(error)).not.toContain("개인 학습 원문"); }
  });
});


describe("실제 제공사 캐시 사용량 형식", (): void => {
  it("수명별 캐시 쓰기를 중복 없이 반영한다", (): void => {
    const value = { ...usage, input_tokens_details: { cached_tokens: 2, cache_write_tokens: 3, cache_write_tokens_details: { ttl_30m_tokens: 3, ttl_12h_tokens: 0 } } };
    expect(normalizeAiUsage(value)).toMatchObject({ inputTokens: 12, cachedInputTokens: 2, cacheWriteTokens: 3, cacheWriteTtl: "30m" });
    expect(normalizeAiUsage(usage).cacheWriteTokens).toBe(0);
  });
  it("누락·수명별 합계 불일치·요청하지 않은 12시간 사용량을 거부한다", (): void => {
    for (const details of [undefined, { ttl_30m_tokens: 1, ttl_12h_tokens: 0 }, { ttl_30m_tokens: 0, ttl_12h_tokens: 1 }]) {
      expect(() => normalizeAiUsage({ ...usage, input_tokens_details: { ...usage.input_tokens_details, cache_write_tokens_details: details } })).toThrow();
    }
  });
});
