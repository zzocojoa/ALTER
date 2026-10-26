import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { preparePageVisionRequest, runPageVision, visionContext } from "../lib/extraction/vision.ts";
import { recordId } from "../lib/domain/contracts.ts";
import type { SiteIdentity } from "../lib/domain/contracts.ts";
import type { AiRunRuntime } from "../lib/ai/run.ts";
import { checkAiFunding } from "../db/repositories/ai-funding.ts";
import { readAiRequestStatus } from "../db/repositories/ai-status.ts";
import { fixturePricing } from "../tests/fixtures/ai-pricing.ts";
import { fixtureFunding } from "../tests/fixtures/ai-funding.ts";
import type { PreparedPageImage } from "../lib/extraction/image.ts";
import type { PricingVersion } from "../lib/ai/pricing.ts";
import type { PageVision } from "../lib/extraction/vision-contract.ts";

const runtime: Miniflare = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('extraction-ai')}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
const checks: Readonly<{ scenario: string; generationRequests: number; countRequests: number; states: readonly string[] }>[] = [];
try {
  const db: D1Database = await runtime.getD1Database("DB") as unknown as D1Database;
  const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((sql: string): string => sql.trim()).filter(Boolean)) await db.prepare(statement).run();
  const now: number = Date.now(); const base = fixturePricing();
  const provenance = { ...base.pricing.provenance, source: "https://example.invalid/mock-only", evidence: "verified" as const, checkedAt: now - 1000, validFrom: now - 1000, validUntil: now + 3600000 };
  const pricing: PricingVersion = { ...base, pricing: { ...base.pricing, provenance }, exchange: { ...base.exchange, provenance }, tax: { ...base.tax, provenance }, fee: { ...base.fee, provenance } };
  for (const scenario of ["success-and-duplicate", "invalid-binding", "429-then-success", "network-unknown", "no-credit", "source-denied", "unreadable-output", "blank-output"]) {
    const owner: SiteIdentity = { realm: "sites", userId: `extraction-ai:${crypto.randomUUID()}` };
    const id = recordId.parse(crypto.randomUUID());
    const image: PreparedPageImage = { dataUrl: "data:image/png;base64,AQ==", mime: "image/png", bytes: 1, sha256: "b".repeat(64), width: 100, height: 200, sourceWidth: 100, sourceHeight: 200, rotation: 0, sourceToImage: [1, 0, 0, 1, 0, 0], coordinateSpace: "pdf-viewport" };
    const prepared = await preparePageVisionRequest({ job: { jobId: id, revision: 1, uploadId: id, selection: { materialId: id, originalHash: "a".repeat(64), originalVersion: "fixture-v1", pages: [{ filePage: 3, purpose: "study" }] } }, filePage: 3 }, image, id);
    const output: PageVision = { kind: "page-vision", binding: { ...prepared.binding, filePage: scenario === "invalid-binding" ? 2 : 3 }, page: { filePage: 3, method: "vision", status: "complete", width: 100, height: 200, rotation: 0, segments: [{ id: "s0", kind: "formula", text: "x^2+y^2", bounds: { x: 0, y: 0, width: 1, height: 1 }, transform: null, uncertain: true, reason: "원본 확인 필요" }], error: null, requiresConfirmation: true } };
    const responseOutput: PageVision = scenario === "unreadable-output" ? { ...output, page: { ...output.page, status: "unreadable", segments: [{ id: "s0", kind: "unreadable", text: "", bounds: null, transform: null, uncertain: true, reason: "흐린 글자를 원본에서 판독할 수 없어요." }] } } : scenario === "blank-output" ? { ...output, page: { ...output.page, status: "blank", segments: [] } } : output;
    let countRequests: number = 0; let generationRequests: number = 0;
    const execution: AiRunRuntime = { db, authenticate: async (): Promise<SiteIdentity> => owner, readApiKey: (): string => "fixture-only-not-a-real-key", now: (): number => now, loadContext: async () => visionContext(prepared.binding), requireSupport: async (): Promise<void> => {}, wait: async (): Promise<void> => {}, warn: (): void => {}, authorizeSources: async (_current, request): Promise<void> => { if (scenario === "source-denied") throw new Error("fixture-source-denied"); assert.equal(request.requestFingerprint, prepared.fingerprint); assert.equal(request.imageCount, 1); }, checkFunding: async (current, bound, checkedAt) => { const funding = fixtureFunding(current.userId, pricing.id, checkedAt); return checkAiFunding(db, current, bound, scenario === "no-credit" ? { ...funding, creditAvailableUnits: 0 } : funding, checkedAt); }, fetch: async (input, init): Promise<Response> => {
      const request: Request = new Request(input, init); const body = JSON.parse(await request.text()) as { model: string; input: unknown; max_output_tokens?: number };
      assert.equal(body.model, "gpt-6-luna"); assert.ok(JSON.stringify(body.input).includes('"filePage\\\":3'));
      if (request.url.endsWith("/input_tokens")) { countRequests += 1; return Response.json({ input_tokens: 1000 }, { headers: { "x-request-id": `req_count_${countRequests}` } }); }
      generationRequests += 1; assert.equal(body.max_output_tokens, 4096);
      if (scenario === "network-unknown") throw new TypeError("fixture-network-reset");
      if (scenario === "429-then-success" && generationRequests === 1) return Response.json({ error: { code: "rate_limit_exceeded", message: "fixture-only" } }, { status: 429, headers: { "retry-after": "0", "x-request-id": "req_rate_limited" } });
      return Response.json({ id: `resp_fixture_${generationRequests}`, model: "gpt-6-luna", object: "response", created_at: 1, status: "completed", max_output_tokens: 4096, output: [{ type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ result: responseOutput }), annotations: [] }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } }, { headers: { "x-request-id": `req_response_${generationRequests}` } });
    } };
    const key: string = `extraction-fixture:${id}`;
    if (["invalid-binding", "network-unknown", "no-credit", "source-denied"].includes(scenario)) await assert.rejects(runPageVision(execution, prepared, key, pricing, new AbortController().signal));
    else {
      const result = await runPageVision(execution, prepared, key, pricing, new AbortController().signal);
      assert.equal(result.kind, "validated");
      if (result.kind === "validated") assert.deepEqual(result.output.result, responseOutput);
    }
    const states = await readAiRequestStatus(db, owner, key);
    if (scenario === "success-and-duplicate") { await runPageVision(execution, prepared, key, pricing, new AbortController().signal); assert.equal(generationRequests, 1); assert.equal(states[0].stage, "validated"); }
    if (scenario === "invalid-binding") { assert.equal(generationRequests, 1); assert.equal(states[0].reservationState, "settled"); assert.equal(states[0].stage, "invalid"); }
    if (scenario === "429-then-success") { assert.equal(generationRequests, 2); assert.equal(states.length, 2); assert.equal(states[1].stage, "validated"); }
    if (scenario === "network-unknown") { assert.ok(generationRequests >= 1 && generationRequests <= 3); assert.ok(states.every((state): boolean => state.reservationState === "unknown")); const count: number = generationRequests; await runPageVision(execution, prepared, key, pricing, new AbortController().signal); assert.equal(generationRequests, count); }
    if (scenario === "no-credit" || scenario === "source-denied") assert.equal(generationRequests, 0);
    if (scenario === "source-denied") assert.equal(countRequests, 0);
    checks.push({ scenario, countRequests, generationRequests, states: states.map((state): string => `${state.stage}:${state.reservationState}`) });
  }
  await writeFile(".taskmaster/reports/task-6-ai-local.json", JSON.stringify({ status: "passed", environment: "local-d1-mock-openai-sdk", actualProviderCalls: 0, checks }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", tests: checks.length, actualProviderCalls: 0, checks }));
} finally { await runtime.dispose(); }
