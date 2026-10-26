import { recordId } from "../../lib/domain/contracts";
import type { LearningContext,LearningOutput } from "../../lib/ai/learning-contract";
import { checkAiFunding } from "../../db/repositories/ai-funding";
import { fixtureFunding } from "./ai-funding";
import { fixturePricing } from "./ai-pricing";
import type { SiteIdentity } from "../../lib/domain/contracts";
import type { AiRunRuntime } from "../../lib/ai/run";
import type { PricingVersion } from "../../lib/ai/pricing";

export type RuntimeFixture = Readonly<{ runtime: AiRunRuntime; pricing: PricingVersion; generations: () => number }>;
/** 실제 SDK·예약·응답 저장을 사용하되 외부 전송만 고정 시험 응답으로 대체합니다. */
export function learningRuntimeFixture(db:D1Database,owner:SiteIdentity,loadContext:()=>Promise<LearningContext>,makeResult:()=>Promise<LearningOutput["result"]>):RuntimeFixture {
  const now: number = Date.now(); const base = fixturePricing();
  const provenance = { ...base.pricing.provenance,evidence: "verified" as const,checkedAt: now-1000,validFrom: now-1000,validUntil: now+3600000 };
  const pricing: PricingVersion = { ...base,id:recordId.parse(crypto.randomUUID()),pricing: { ...base.pricing,provenance },exchange: { ...base.exchange,provenance },tax: { ...base.tax,provenance },fee: { ...base.fee,provenance } };
  const fixtureId:string=crypto.randomUUID();let generations: number = 0;
  const runtime: AiRunRuntime = { db,authenticate: async () => owner,readApiKey: (): string => "fixture-only-not-a-key",now: Date.now,loadContext,requireSupport: async (): Promise<void> => {},wait: async (): Promise<void> => {},warn: (): void => {},authorizeSources: async (): Promise<void> => {},checkFunding: (current,bound,at) => checkAiFunding(db,current,bound,fixtureFunding(current.userId,pricing.id,at),at),fetch: async (input,init): Promise<Response> => {
    const request = new Request(input,init); if (request.method === "GET") throw new Error("저장된 검증 결과를 외부 조회할 필요가 없어요.");
    const body = JSON.parse(await request.text()) as Readonly<{ max_output_tokens: number }>;
    if (request.url.endsWith("/input_tokens")) return Response.json({ input_tokens: 1000 },{ headers: { "x-request-id": "req_learning_fixture_count" } });
    generations += 1;
    const result = await makeResult();
    return Response.json({ id: `resp_learning_fixture_${fixtureId}_${generations}`,model: "gpt-6-luna",object: "response",created_at: 1,status: "completed",max_output_tokens: body.max_output_tokens,output: [{ type: "message",id: "msg_learning_fixture",role: "assistant",status: "completed",content: [{ type: "output_text",text: JSON.stringify({ result }),annotations: [] }] }],usage: { input_tokens: 1000,input_tokens_details: { cached_tokens: 0,cache_write_tokens: 0,cache_write_tokens_details: { ttl_30m_tokens: 0,ttl_12h_tokens: 0 } },output_tokens: 200,output_tokens_details: { reasoning_tokens: 0 },total_tokens: 1200 } },{ headers: { "x-request-id": `req_learning_fixture_${fixtureId}_${generations}` } });
  } };
  return { runtime,pricing,generations: (): number => generations };
}
