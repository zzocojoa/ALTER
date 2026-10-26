import { z } from "zod";
import { tokenUsage } from "./pricing.ts";
import type { TokenUsage } from "./pricing.ts";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const providerUsage = z.object({ input_tokens: count, input_tokens_details: z.object({ cached_tokens: count, cache_write_tokens: count, cache_write_tokens_details: z.object({ ttl_30m_tokens: count, ttl_12h_tokens: z.literal(0) }).strict() }).strict().refine((value): boolean => value.cache_write_tokens === value.cache_write_tokens_details.ttl_30m_tokens, "30분 캐시 쓰기 합계가 일치해야 합니다."), output_tokens: count, output_tokens_details: z.object({ reasoning_tokens: count }).strict(), total_tokens: count }).strict();

/** 고정 요청은 30분 명시적 캐시 모드이며 누락된 사용량을 0으로 대체하지 않습니다. */
export function normalizeAiUsage(raw: unknown): TokenUsage {
  const value = providerUsage.parse(raw);
  return tokenUsage.parse({ inputTokens: value.input_tokens, cachedInputTokens: value.input_tokens_details.cached_tokens, cacheWriteTokens: value.input_tokens_details.cache_write_tokens, cacheWriteTtl: "30m", outputTokens: value.output_tokens, reasoningTokens: value.output_tokens_details.reasoning_tokens, totalTokens: value.total_tokens });
}
