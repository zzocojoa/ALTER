import { assertNoVerificationRecords } from "../tests/fixtures/diagnostic-cleanup.ts";
import { runAiLedgerAcceptance } from "../lib/ai/ledger-acceptance.ts";
import { fixtureFunding } from "../tests/fixtures/ai-funding.ts";
import { checkAiFunding } from "../db/repositories/ai-funding.ts";
import type { FundingSnapshot } from "../lib/ai/funding.ts";
import { recoverAiResponse } from "../lib/ai/recover.ts";
import { readAiRequestStatus } from "../db/repositories/ai-status.ts";
import { runAiRequest } from "../lib/ai/run.ts";
import type { RetryWarning } from "../lib/ai/retry.ts";
import { completeAiDelivery } from "../lib/ai/complete.ts";
import { preserveAiUnknown, settleAiUsage, storeAiEvidence } from "../db/repositories/ai-settlement.ts";
import { readAiCall } from "../db/repositories/ai-call.ts";
import { responseFacts } from "../lib/ai/response.ts";
import type { AiDelivery } from "../lib/ai/attempt.ts";
import { emptyLearningContext } from "../tests/fixtures/ai-learning-context.ts";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { enqueueExternalJob, claimExternalStep, markExternalUnknown } from "../db/repositories/external.ts";
import { beginAiDispatch } from "../db/repositories/ai-call.ts";
import { executeAiAttempt } from "../lib/ai/attempt.ts";
import type { AttemptRuntime } from "../lib/ai/attempt.ts";
import { recordId } from "../lib/domain/contracts.ts";
import { reserveAiCost, readAiCostIntent } from "../db/repositories/ai-cost.ts";
import type { AiCostInput } from "../db/repositories/ai-cost.ts";
import { createCostWindow, seoulMonthWindow } from "../db/repositories/usage.ts";
import { prepareAiRequest, calculateRequestBound } from "../lib/ai/request-bound.ts";
import type { ModelRequest } from "../lib/ai/request-bound.ts";
import type { Command, SiteIdentity } from "../lib/domain/contracts.ts";
import type { PricingVersion } from "../lib/ai/pricing.ts";
import { fixturePricing } from "../tests/fixtures/ai-pricing.ts";

type WindowRow = Readonly<{ version: number; reserved_units: number; settled_units: number; limit_units: number }>;
type Fixture = Readonly<{ owner: SiteIdentity; context: Command; input: AiCostInput }>;
const now: number = Date.parse("2026-10-24T01:00:00Z");
const request: ModelRequest = { instructions: "검사 전용", messages: [{ role: "user", content: [{ type: "input_text", text: "질문" }] }], maximumOutputTokens: 64, reasoningEffort: "none" };
const checks: string[] = [];
const runtime: Miniflare = new Miniflare({ modules: true, script: "export default {fetch() {return new Response('ai-cost');}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });

function prices(): PricingVersion {
  const original = fixturePricing();
  const provenance = { ...original.pricing.provenance, checkedAt: now - 1000, validFrom: now - 1000, validUntil: now + 86_400_000 };
  return { ...original, pricing: { ...original.pricing, provenance }, exchange: { ...original.exchange, provenance, krwPerUsd: "10000000" }, tax: { provenance, multiplier: "1" }, fee: { provenance, multiplier: "1" } };
}
async function fixture(db: D1Database): Promise<Fixture> {
  const owner: SiteIdentity = { realm: "sites", userId: `ai-cost-test:${crypto.randomUUID()}` };
  const windowId: string = crypto.randomUUID();
  const context: Command = { owner, requestKey: "request-1", expectedVersion: 1 };
  await createCostWindow(db, { ...context, requestKey: "window" }, { id: windowId as ReturnType<typeof import("../lib/domain/contracts.ts").recordId.parse>, category: "ai", ...seoulMonthWindow(now) });
  const prepared = await prepareAiRequest(request);
  const pricing = prices();
  const bound = await calculateRequestBound(prepared, { requestFingerprint: prepared.requestFingerprint, model: "gpt-6-luna", inputTokens: 1000, providerRequestId: "req_count_fixture", checkedAt: now }, pricing, now);
  return { owner, context, input: { id: crypto.randomUUID(), windowId, scope: "response", now, prepared, bound, pricing, funding: fixtureFunding(owner.userId, pricing.id, now) } };
}
async function windowRow(db: D1Database, current: Fixture): Promise<WindowRow> {
  const row: WindowRow | null = await db.prepare("SELECT version,reserved_units,settled_units,limit_units FROM cost_windows WHERE owner_id = ? AND id = ?").bind(current.owner.userId, current.input.windowId).first<WindowRow>();
  assert.ok(row); return row;
}
async function assertEmpty(db: D1Database, current: Fixture): Promise<void> {
  for (const table of ["cost_reservations", "ai_cost_intents", "ai_pricing_versions"]) assert.equal(await db.prepare(`SELECT count(*) AS count FROM ${table} WHERE owner_id = ?`).bind(current.owner.userId).first<number>("count"), 0, table);
  assert.equal((await windowRow(db, current)).reserved_units, 0);
}

try {
  const db: D1Database = await runtime.getD1Database("DB") as unknown as D1Database;
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  const preservedOwner: SiteIdentity = { realm: "sites", userId: "migration-preserved-external" };
  const preservedJob = recordId.parse(crypto.randomUUID()); const preservedStep = recordId.parse(crypto.randomUUID());
  for (const entry of journal.entries) {
    if (entry.tag.startsWith("0007_")) {
      await enqueueExternalJob(db, { owner: preservedOwner, requestKey: "enqueue", expectedVersion: 1 }, { id: preservedJob, weeklyVersionId: null, businessKey: "preserved", kind: "calendar", steps: [{ id: preservedStep, kind: "create" }] });
      await claimExternalStep(db, { owner: preservedOwner, requestKey: "claim", expectedVersion: 1 }, { stepId: preservedStep, attemptId: recordId.parse(crypto.randomUUID()), ordinal: 1, now, leaseUntil: now + 60_000 });
      await markExternalUnknown(db, { owner: preservedOwner, requestKey: "unknown", expectedVersion: 2 }, preservedStep, "provider-outcome-unknown");
    }
    for (const sql of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((value: string): string => value.trim()).filter(Boolean)) await db.prepare(sql).run();
  }
  const preserved = await db.prepare("SELECT j.state AS job_state,s.state AS step_state,a.outcome,s.evidence FROM external_jobs j JOIN external_steps s ON s.owner_id = j.owner_id AND s.job_id = j.id JOIN external_attempts a ON a.owner_id = s.owner_id AND a.step_id = s.id WHERE j.owner_id = ?").bind(preservedOwner.userId).first();
  assert.deepEqual(preserved, { job_state: "running", step_state: "unknown", outcome: "unknown", evidence: "provider-outcome-unknown" });
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  await assert.rejects(db.prepare("INSERT INTO external_jobs VALUES (?,?,1,?,NULL,?,'weekly-export','pending')").bind(preservedOwner.userId, crypto.randomUUID(), crypto.randomUUID(), "invalid-weekly").run(), /invalid_export_version/);
  checks.push("existing-external-data-and-trigger-preserved");
  const concurrent = await fixture(db);
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, index: number) => reserveAiCost(db, { ...concurrent.context, requestKey: `concurrent-${index}` }, { ...concurrent.input, id: crypto.randomUUID() })));
  assert.equal(outcomes.filter((item): boolean => item.status === "fulfilled").length, 1);
  const concurrentRow = await windowRow(db, concurrent);
  assert.equal(concurrentRow.reserved_units, concurrent.input.bound.amount.units);
  assert.ok(concurrentRow.reserved_units + concurrentRow.settled_units <= concurrentRow.limit_units);
  await reserveAiCost(db, { ...concurrent.context, requestKey: "second", expectedVersion: concurrentRow.version }, { ...concurrent.input, id: crypto.randomUUID() });
  const two = await windowRow(db, concurrent);
  await assert.rejects(reserveAiCost(db, { ...concurrent.context, requestKey: "over", expectedVersion: two.version }, { ...concurrent.input, id: crypto.randomUUID() }), (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "limit_exceeded");
  assert.deepEqual(await windowRow(db, concurrent), two); checks.push("concurrent-cas-and-monthly-cap");

  const exact = await fixture(db);
  await db.prepare("UPDATE cost_windows SET limit_units = ? WHERE owner_id = ?").bind(exact.input.bound.amount.units, exact.owner.userId).run();
  const first = await reserveAiCost(db, exact.context, exact.input); assert.equal(first.created, true);
  const duplicate = await reserveAiCost(db, exact.context, { ...exact.input, id: crypto.randomUUID() }); assert.equal(duplicate.created, false); assert.equal(duplicate.intent.id, first.intent.id);
  assert.equal((await windowRow(db, exact)).reserved_units, exact.input.bound.amount.units);
  assert.equal(await readAiCostIntent(db, { realm: "sites", userId: "different-owner" }, "response", "request-1"), null); checks.push("exact-balance-idempotency-owner-isolation");
  const changed = await prepareAiRequest({ ...request, instructions: "다른 요청" });
  const changedBound = await calculateRequestBound(changed, { requestFingerprint: changed.requestFingerprint, model: "gpt-6-luna", inputTokens: 1000, providerRequestId: "req_changed", checkedAt: now }, exact.input.pricing, now);
  await assert.rejects(reserveAiCost(db, exact.context, { ...exact.input, prepared: changed, bound: changedBound }), (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "request_key_reused"); checks.push("same-key-different-fingerprint-rejected");

  const oneOver = await fixture(db);
  await db.prepare("UPDATE cost_windows SET limit_units = ? WHERE owner_id = ?").bind(oneOver.input.bound.amount.units - 1_000_000, oneOver.owner.userId).run();
  await assert.rejects(reserveAiCost(db, oneOver.context, oneOver.input)); await assertEmpty(db, oneOver); checks.push("one-won-over-full-rollback");
  const zeroRows = await fixture(db);
  await assert.rejects(reserveAiCost(db, { ...zeroRows.context, expectedVersion: 999 }, zeroRows.input)); await assertEmpty(db, zeroRows); checks.push("conditional-update-zero-full-rollback");

  const insertFailure = await fixture(db);
  await db.prepare("CREATE TRIGGER inject_ai_insert_failure BEFORE INSERT ON cost_reservations WHEN NEW.owner_id = '" + insertFailure.owner.userId + "' BEGIN SELECT RAISE(ABORT,'injected_insert_failure'); END;").run();
  await assert.rejects(reserveAiCost(db, insertFailure.context, insertFailure.input)); await assertEmpty(db, insertFailure); checks.push("reservation-insert-failure-full-rollback");
  const updateFailure = await fixture(db);
  await db.prepare("CREATE TRIGGER inject_ai_update_failure BEFORE UPDATE ON cost_windows WHEN NEW.owner_id = '" + updateFailure.owner.userId + "' BEGIN SELECT RAISE(ABORT,'injected_update_failure'); END;").run();
  await assert.rejects(reserveAiCost(db, updateFailure.context, updateFailure.input)); await assertEmpty(db, updateFailure); checks.push("aggregate-update-failure-full-rollback");

  await assert.rejects(db.prepare("UPDATE ai_pricing_versions SET snapshot = '{}' WHERE owner_id = ?").bind(exact.owner.userId).run(), /immutable/);
  await assert.rejects(db.prepare("UPDATE ai_cost_intents SET request_fingerprint = 'changed' WHERE owner_id = ?").bind(exact.owner.userId).run(), /immutable/); checks.push("immutable-pricing-and-request-evidence");
  const blocked = await fixture(db); const reserved = await reserveAiCost(db, blocked.context, blocked.input);
  await db.prepare("INSERT INTO ai_budget_blocks VALUES (?,?,?,?,?,?)").bind(blocked.owner.userId, crypto.randomUUID(), reserved.intent.id, "bound-exceeded", reserved.intent.amountUnits + 1, now).run();
  const beforeBlock = await windowRow(db, blocked);
  await assert.rejects(reserveAiCost(db, { ...blocked.context, requestKey: "after-block", expectedVersion: beforeBlock.version }, { ...blocked.input, id: crypto.randomUUID() }));
  assert.deepEqual(await windowRow(db, blocked), beforeBlock); checks.push("anomaly-blocks-additional-reservation");
  const dispatch = await fixture(db); await reserveAiCost(db, dispatch.context, dispatch.input);
  const dispatchInput = { reservationId: dispatch.input.id, costScope: dispatch.input.scope, costRequestKey: dispatch.context.requestKey, logicalRequestKey: "dispatch-request", attemptOrdinal: 1, now };
  const sent = await beginAiDispatch(db, dispatch.owner, dispatchInput);
  assert.equal(sent.stage, "intent");
  await assert.rejects(beginAiDispatch(db, dispatch.owner, dispatchInput));
  const missing = await fixture(db);
  await assert.rejects(beginAiDispatch(db, missing.owner, { ...dispatchInput, reservationId: missing.input.id }));
  assert.equal(await db.prepare("SELECT count(*) AS count FROM ai_calls WHERE owner_id = ?").bind(missing.owner.userId).first<number>("count"), 0);
  checks.push("reserved-dispatch-once-and-missing-reservation-denied");
  const sdk = await fixture(db);
  const networkRequests: string[] = [];
  const modelBodies: string[] = [];
  const verifiedPricing: PricingVersion = { ...sdk.input.pricing, pricing: { ...sdk.input.pricing.pricing, provenance: { ...sdk.input.pricing.pricing.provenance, evidence: "verified" } }, exchange: { ...sdk.input.pricing.exchange, provenance: { ...sdk.input.pricing.exchange.provenance, evidence: "verified" } }, tax: { ...sdk.input.pricing.tax, provenance: { ...sdk.input.pricing.tax.provenance, evidence: "verified" } }, fee: { ...sdk.input.pricing.fee, provenance: { ...sdk.input.pricing.fee.provenance, evidence: "verified" } } };
  const sdkRuntime: AttemptRuntime = { db, authenticate: async (): Promise<SiteIdentity> => sdk.owner, authorizeSources: async (): Promise<void> => {}, checkFunding: async (owner, bound, checkedAt): Promise<FundingSnapshot> => checkAiFunding(db, owner, bound, fixtureFunding(owner.userId, bound.amount.pricingVersionId, checkedAt), checkedAt), readApiKey: (): string => "fixture-only-secret", now: (): number => now, fetch: async (input, init): Promise<Response> => {
    const req: Request = new Request(input, init); networkRequests.push(req.url);
    assert.equal(req.headers.get("authorization"), "Bearer fixture-only-secret");
    if (req.url.endsWith("/responses/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: 1000 }, { headers: { "x-request-id": "req_count_fixture" } });
    assert.equal(req.url, "https://api.openai.com/v1/responses");
    modelBodies.push(await req.text());
    return Response.json({ id: "resp_fixture", model: "gpt-6-luna", object: "response", created_at: 1, status: "completed", max_output_tokens: request.maximumOutputTokens, output: [{ type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ result: { kind: "diagnostic-question", question: "설명해 주세요.", waitForAnswer: true } }), annotations: [] }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 32, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1032 } }, { headers: { "x-request-id": "req_response_fixture" } });
  } };
  const sdkInput = { logicalRequestKey: "sdk-once", attemptOrdinal: 1, windowId: sdk.input.windowId, windowVersion: 1, request, pricing: verifiedPricing };
  await assert.rejects(executeAiAttempt({ ...sdkRuntime, authenticate: async (): Promise<SiteIdentity> => { throw new Error("owner-rejected"); } }, sdkInput, new AbortController().signal), /owner-rejected/);
  assert.equal(networkRequests.length, 0);
  await assert.rejects(executeAiAttempt({ ...sdkRuntime, authorizeSources: async (): Promise<void> => { throw new Error("source-rejected"); } }, sdkInput, new AbortController().signal), /source-rejected/);
  assert.equal(networkRequests.length, 0);
  await assert.rejects(executeAiAttempt({ ...sdkRuntime, checkFunding: async (): Promise<FundingSnapshot> => { throw new Error("funding-rejected"); } }, sdkInput, new AbortController().signal), /funding-rejected/);
  assert.equal(modelBodies.length, 0);
  const delivery = await executeAiAttempt(sdkRuntime, sdkInput, new AbortController().signal);
  assert.equal(delivery.kind, "received");
  if (delivery.kind !== "received") throw new Error("모의 SDK 응답이 없습니다.");
  assert.equal((await delivery.parse()).result.kind, "diagnostic-question");
  assert.equal(modelBodies.length, 1);
  const body: { model: string; tools: unknown[]; tool_choice: string; max_output_tokens: number; text: { format: { strict: boolean } } } = JSON.parse(modelBodies[0]);
  assert.equal(body.model, "gpt-6-luna"); assert.deepEqual(body.tools, []); assert.equal(body.tool_choice, "none"); assert.equal(body.max_output_tokens, 64); assert.equal(body.text.format.strict, true); assert.equal(modelBodies[0].includes("fixture-only-secret"), false);
  const requestCount: number = networkRequests.length;
  assert.equal((await executeAiAttempt(sdkRuntime, sdkInput, new AbortController().signal)).kind, "existing");
  assert.equal(networkRequests.length, requestCount);
  const noBudget = await fixture(db);
  await db.prepare("UPDATE cost_windows SET limit_units = 0 WHERE owner_id = ?").bind(noBudget.owner.userId).run();
  await assert.rejects(executeAiAttempt({ ...sdkRuntime, authenticate: async (): Promise<SiteIdentity> => noBudget.owner }, { ...sdkInput, windowId: noBudget.input.windowId, logicalRequestKey: "no-budget" }, new AbortController().signal));
  assert.equal(modelBodies.length, 1);
  checks.push("sdk-owner-source-funding-budget-gates-and-one-generation");
  checks.push("sdk-duplicate-no-network-fixed-model-format-no-tools-no-secret");
  async function received(): Promise<Readonly<{ current: Fixture; delivery: AiDelivery }>> {
    const current = await fixture(db);
    const outcome = await executeAiAttempt({ ...sdkRuntime, authenticate: async (): Promise<SiteIdentity> => current.owner }, { ...sdkInput, windowId: current.input.windowId, logicalRequestKey: crypto.randomUUID() }, new AbortController().signal);
    if (outcome.kind !== "received") throw new Error("정산 검사 응답이 없습니다.");
    return { current, delivery: outcome };
  }
  const completion = { db, now: (): number => now, loadContext: async () => emptyLearningContext() };
  const normal = await received();
  const parsed = await completeAiDelivery(completion, { ...normal.delivery, parse: async () => {
    const state = await readAiCall(db, normal.current.owner, normal.delivery.call.id);
    assert.equal(state?.stage, "settled");
    assert.equal((await windowRow(db, normal.current)).reserved_units, 0);
    return normal.delivery.parse();
  } }, "diagnostic-question");
  assert.equal(parsed.result.kind, "diagnostic-question");
  assert.equal((await readAiCall(db, normal.current.owner, normal.delivery.call.id))?.stage, "validated");
  const afterSettlement = await windowRow(db, normal.current);
  await Promise.all(Array.from({ length: 4 }, () => settleAiUsage(db, normal.current.owner, normal.delivery.call.id, now)));
  assert.deepEqual(await windowRow(db, normal.current), afterSettlement);
  assert.equal(await db.prepare("SELECT count(*) AS count FROM cost_usage WHERE owner_id=?").bind(normal.current.owner.userId).first<number>("count"), 1);
  checks.push("usage-settled-before-parse-and-duplicate-settlement-no-change");

  for (const kind of ["refusal", "schema", "incomplete"]) {
    const current = await received();
    const raw = current.delivery.raw as Record<string, unknown>;
    const modified = kind === "refusal" ? { ...raw, output: [{ type: "message", content: [{ type: "refusal", refusal: "fixture" }] }] } : kind === "incomplete" ? { ...raw, status: "incomplete" } : raw;
    await assert.rejects(completeAiDelivery(completion, { ...current.delivery, raw: modified, parse: async () => { throw new SyntaxError("fixture"); } }, "diagnostic-question"));
    assert.equal((await windowRow(db, current.current)).reserved_units, 0);
    assert.ok((await windowRow(db, current.current)).settled_units > 0);
    assert.equal((await readAiCall(db, current.current.owner, current.delivery.call.id))?.stage, "invalid");
  }
  checks.push("refusal-incomplete-invalid-json-still-settled");

  const rollback = await received();
  await storeAiEvidence(db, rollback.current.owner, rollback.delivery.call.id, { facts: responseFacts(rollback.delivery.raw), providerRequestId: rollback.delivery.providerRequestId, httpStatus: 200 });
  const beforeRollback = await windowRow(db, rollback.current);
  await db.prepare("CREATE TRIGGER inject_ai_settlement_failure BEFORE INSERT ON cost_usage WHEN NEW.owner_id='" + rollback.current.owner.userId + "' BEGIN SELECT RAISE(ABORT,'injected_settlement_failure'); END;").run();
  await assert.rejects(settleAiUsage(db, rollback.current.owner, rollback.delivery.call.id, now));
  assert.deepEqual(await windowRow(db, rollback.current), beforeRollback);
  assert.equal((await readAiCall(db, rollback.current.owner, rollback.delivery.call.id))?.stage, "usage-stored");
  assert.equal(await db.prepare("SELECT state FROM cost_reservations WHERE owner_id=? AND id=?").bind(rollback.current.owner.userId, rollback.delivery.call.id).first<string>("state"), "reserved");
  await db.prepare("DROP TRIGGER inject_ai_settlement_failure").run();
  await settleAiUsage(db, rollback.current.owner, rollback.delivery.call.id, now);
  checks.push("settlement-batch-rollback-preserves-usage-and-reservation");

  const missingUsage = await received();
  await assert.rejects(completeAiDelivery(completion, { ...missingUsage.delivery, raw: { ...(missingUsage.delivery.raw as Record<string, unknown>), usage: null } }, "diagnostic-question"));
  const unknownWindow = await windowRow(db, missingUsage.current);
  assert.equal(unknownWindow.reserved_units, missingUsage.delivery.intent.amountUnits);
  assert.equal((await readAiCall(db, missingUsage.current.owner, missingUsage.delivery.call.id))?.stage, "unknown");
  const recovery = await storeAiEvidence(db, missingUsage.current.owner, missingUsage.delivery.call.id, { facts: responseFacts(missingUsage.delivery.raw), providerRequestId: missingUsage.delivery.providerRequestId, httpStatus: 200 });
  assert.equal(recovery.stage, "usage-stored");
  await settleAiUsage(db, missingUsage.current.owner, recovery.id, now);
  assert.equal((await windowRow(db, missingUsage.current)).reserved_units, 0);
  checks.push("missing-usage-keeps-reservation-later-known-usage-recovers");

  const unknownPeer = await received();
  await preserveAiUnknown(db, unknownPeer.current.owner, unknownPeer.delivery.call.id, "ai_response_lost", now);
  const peerWindow = await windowRow(db, unknownPeer.current);
  const peer = await executeAiAttempt({ ...sdkRuntime, authenticate: async (): Promise<SiteIdentity> => unknownPeer.current.owner }, { ...sdkInput, logicalRequestKey: "unknown-peer", windowId: unknownPeer.current.input.windowId, windowVersion: peerWindow.version }, new AbortController().signal);
  if (peer.kind !== "received") throw new Error("별도 시도 응답이 없습니다.");
  await completeAiDelivery(completion, peer, "diagnostic-question");
  assert.equal((await windowRow(db, unknownPeer.current)).reserved_units, unknownPeer.delivery.intent.amountUnits);
  checks.push("other-unknown-attempt-remains-reserved-after-settlement");

  const overrun = await received();
  const overrunRaw = { ...(overrun.delivery.raw as Record<string, unknown>), usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 1000, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2000 } };
  await storeAiEvidence(db, overrun.current.owner, overrun.delivery.call.id, { facts: responseFacts(overrunRaw), providerRequestId: overrun.delivery.providerRequestId, httpStatus: 200 });
  const anomaly = await settleAiUsage(db, overrun.current.owner, overrun.delivery.call.id, now);
  assert.equal(anomaly.state, "overrun"); assert.ok(anomaly.actual && anomaly.actual.units > overrun.delivery.intent.amountUnits);
  assert.equal(await db.prepare("SELECT actual_units FROM ai_budget_blocks WHERE owner_id=?").bind(overrun.current.owner.userId).first<number>("actual_units"), anomaly.actual.units);
  const beforeBlockedCall = modelBodies.length;
  await assert.rejects(executeAiAttempt({ ...sdkRuntime, authenticate: async (): Promise<SiteIdentity> => overrun.current.owner }, { ...sdkInput, logicalRequestKey: "after-overrun", windowId: overrun.current.input.windowId, windowVersion: (await windowRow(db, overrun.current)).version }, new AbortController().signal));
  assert.equal(modelBodies.length, beforeBlockedCall);
  assert.equal((await windowRow(db, overrun.current)).reserved_units, overrun.delivery.intent.amountUnits);
  checks.push("overrun-full-cost-preserved-no-clamp-new-generation-blocked");

  const failedTransport = await fixture(db);
  await assert.rejects(executeAiAttempt({ ...sdkRuntime, authenticate: async (): Promise<SiteIdentity> => failedTransport.owner, fetch: async (input, init): Promise<Response> => {
    if (new Request(input, init).url.endsWith("/responses/input_tokens")) return Response.json({ input_tokens: 1000 }, { headers: { "x-request-id": "req_count" } });
    throw new TypeError("network failed fixture");
  } }, { ...sdkInput, windowId: failedTransport.input.windowId }, new AbortController().signal), (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ai_transport_failed");
  assert.equal(await db.prepare("SELECT state FROM cost_reservations WHERE owner_id=?").bind(failedTransport.owner.userId).first<string>("state"), "unknown");
  assert.ok((await windowRow(db, failedTransport)).reserved_units > 0);
  checks.push("network-failure-keeps-unknown-reservation");
  for (const scenario of ["retry-success", "retry-budget", "retry-exhausted", "no-retry-auth", "no-retry-schema"]) {
    const current = await fixture(db);
    const warnings: RetryWarning[] = [];
    const transmissions: string[] = [];
    const waits: number[] = [];
    const runPricing: PricingVersion = scenario === "retry-exhausted" ? { ...verifiedPricing, id: recordId.parse(crypto.randomUUID()), exchange: { ...verifiedPricing.exchange, krwPerUsd: "1000" } } : verifiedPricing;
    const runRuntime = { ...sdkRuntime, ...completion, authenticate: async (): Promise<SiteIdentity> => current.owner, requireSupport: async (): Promise<void> => {}, wait: async (milliseconds: number): Promise<void> => { waits.push(milliseconds); }, warn: (warning: RetryWarning): void => { warnings.push(warning); }, fetch: async (input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> => {
      const req = new Request(input, init);
      if (req.url.endsWith("/responses/input_tokens")) return sdkRuntime.fetch(input, init);
      transmissions.push(req.headers.get("x-client-request-id") ?? "missing");
      if (scenario === "no-retry-schema") {
        const response = await sdkRuntime.fetch(input, init);
        const raw: Record<string, unknown> = await response.json();
        return Response.json({ ...raw, status: "incomplete" }, { headers: { "x-request-id": "req_incomplete" } });
      }
      if (scenario === "retry-success" && transmissions.length === 2) return sdkRuntime.fetch(input, init);
      return Response.json({ error: { code: "fixture_error", message: "fixture" } }, { status: scenario === "no-retry-auth" ? 401 : 503, headers: { "retry-after": "0", "x-request-id": "req_failure" } });
    } };
    const runInput = { logicalRequestKey: scenario, request, pricing: runPricing, expectedKind: "diagnostic-question" as const };
    if (scenario === "retry-success") assert.equal((await runAiRequest(runRuntime, runInput, new AbortController().signal)).kind, "validated");
    else await assert.rejects(runAiRequest(runRuntime, runInput, new AbortController().signal));
    const count: number = scenario === "retry-success" || scenario === "retry-budget" ? 2 : scenario === "retry-exhausted" ? 3 : 1;
    assert.equal(transmissions.length, count, scenario);
    assert.equal(new Set(transmissions).size, count);
    const rows = await db.prepare("SELECT r.state,r.amount_units,c.attempt_ordinal FROM cost_reservations r JOIN ai_calls c ON c.owner_id=r.owner_id AND c.id=r.id WHERE r.owner_id=? ORDER BY c.attempt_ordinal").bind(current.owner.userId).all<{ state: string; amount_units: number; attempt_ordinal: number }>();
    assert.equal(rows.results.length, count);
    assert.equal(rows.results.filter((row) => row.state === "unknown").length, scenario === "retry-success" ? 1 : scenario === "no-retry-schema" ? 0 : count);
    if (scenario.startsWith("no-retry")) assert.equal(warnings.length, 0);
    for (const warning of warnings) assert.equal(warning.previousReservation, "retained-unknown");
    const priorTransmissions: number = transmissions.length;
    assert.equal((await runAiRequest(runRuntime, runInput, new AbortController().signal)).kind, "existing");
    assert.equal(transmissions.length, priorTransmissions);
    checks.push(scenario);
  }
  const resumable = await received();
  const statusKey: string = resumable.delivery.call.logicalRequestKey;
  const originalNetworkCount: number = networkRequests.length;
  const existingStatus = await readAiRequestStatus(db, resumable.current.owner, statusKey);
  assert.equal(existingStatus.length, 1); assert.equal(existingStatus[0].automaticReplayAllowed, false);
  assert.deepEqual(await readAiRequestStatus(db, { realm: "sites", userId: "wrong-owner" }, statusKey), []);
  const recoveryRequests: string[] = [];
  const recoveryRuntime = { ...completion, authenticate: async (): Promise<SiteIdentity> => resumable.current.owner, readApiKey: (): string => "fixture-recovery", fetch: async (input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> => {
    const req = new Request(input, init); recoveryRequests.push(req.url); assert.equal(req.method, "GET");
    assert.equal(req.url, "https://api.openai.com/v1/responses/resp_fixture?stream=false");
    return Response.json(resumable.delivery.raw, { headers: { "x-request-id": "req_recovery" } });
  } };
  await assert.rejects(recoverAiResponse(recoveryRuntime, resumable.delivery.call.id, "diagnostic-question", new AbortController().signal));
  assert.equal(recoveryRequests.length, 0);
  await storeAiEvidence(db, resumable.current.owner, resumable.delivery.call.id, { facts: { ...responseFacts(resumable.delivery.raw), usage: null, status: "in_progress" }, providerRequestId: "req_pending", httpStatus: 200 });
  await preserveAiUnknown(db, resumable.current.owner, resumable.delivery.call.id, "ai_connection_interrupted", now);
  assert.equal((await recoverAiResponse(recoveryRuntime, resumable.delivery.call.id, "diagnostic-question", new AbortController().signal)).result.kind, "diagnostic-question");
  assert.equal(recoveryRequests.length, 1);
  await recoverAiResponse(recoveryRuntime, resumable.delivery.call.id, "diagnostic-question", new AbortController().signal);
  assert.equal(recoveryRequests.length, 1);
  assert.equal(networkRequests.length, originalNetworkCount);
  assert.equal((await readAiRequestStatus(db, resumable.current.owner, statusKey))[0].outstandingReservedUnits, 0);
  checks.push("owner-status-no-generation-and-known-response-id-only-recovery");

  const reservationOnly = await fixture(db);
  await reserveAiCost(db, { ...reservationOnly.context, requestKey: "before-send:1" }, { ...reservationOnly.input, scope: "openai.response" });
  const reservationStatus = await readAiRequestStatus(db, reservationOnly.owner, "before-send");
  assert.equal(reservationStatus[0].stage, null); assert.ok(reservationStatus[0].outstandingReservedUnits > 0);
  const beforeRefresh: number = networkRequests.length;
  assert.equal((await executeAiAttempt({ ...sdkRuntime, authenticate: async (): Promise<SiteIdentity> => reservationOnly.owner }, { ...sdkInput, logicalRequestKey: "before-send", windowId: reservationOnly.input.windowId }, new AbortController().signal)).kind, "existing");
  assert.equal(networkRequests.length, beforeRefresh);
  checks.push("reservation-before-send-interruption-never-auto-replayed");
  const creditRace = await fixture(db);
  const limitedFunding = { ...creditRace.input.funding, creditAvailableUnits: creditRace.input.bound.amount.units };
  const limited = { ...creditRace.input, funding: limitedFunding };
  await reserveAiCost(db, creditRace.context, limited);
  const creditBefore = await windowRow(db, creditRace);
  await assert.rejects(reserveAiCost(db, { ...creditRace.context, requestKey: "credit-second", expectedVersion: creditBefore.version }, { ...limited, id: crypto.randomUUID() }));
  assert.deepEqual(await windowRow(db, creditRace), creditBefore);
  assert.equal(await db.prepare("SELECT count(*) AS count FROM ai_funding_checks WHERE owner_id=?").bind(creditRace.owner.userId).first<number>("count"), 1);
  await assert.rejects(db.prepare("UPDATE ai_funding_checks SET snapshot='{}' WHERE owner_id=?").bind(creditRace.owner.userId).run(), /immutable/);
  await assert.rejects(db.prepare("DELETE FROM ai_funding_checks WHERE owner_id=?").bind(creditRace.owner.userId).run(), /immutable/);
  checks.push("funding-cap-atomic-and-immutable-evidence");

  const totalBudget = await fixture(db);
  const totalFunding = { ...totalBudget.input.funding, billingMode: "postpaid" as const, creditAvailableUnits: 0, payments: [{ id: "other-bill", kind: "other-operation" as const, units: 9_000_000_000, paidAt: now }] };
  await assert.rejects(reserveAiCost(db, totalBudget.context, { ...totalBudget.input, funding: totalFunding }));
  await assertEmpty(db, totalBudget);
  const badReconciliation = { ...totalBudget.input.funding, reconciledReservationIds: [recordId.parse(crypto.randomUUID())] };
  await assert.rejects(reserveAiCost(db, totalBudget.context, { ...totalBudget.input, funding: badReconciliation }));
  await assertEmpty(db, totalBudget);
  checks.push("additional-monthly-budget-and-false-reconciliation-denied");
  const monthOwner: SiteIdentity = { realm: "sites", userId: `month:${crypto.randomUUID()}` };
  let monthClock: number = Date.parse("2026-10-31T14:59:59.500Z");
  const monthSource = { ...verifiedPricing.pricing.provenance, checkedAt: now - 1000, validFrom: now - 1000, validUntil: Date.parse("2026-12-01T00:00:00Z") };
  const monthPricing: PricingVersion = { ...verifiedPricing, id: recordId.parse(crypto.randomUUID()), pricing: { ...verifiedPricing.pricing, provenance: monthSource }, exchange: { ...verifiedPricing.exchange, provenance: monthSource, krwPerUsd: "1000" }, tax: { ...verifiedPricing.tax, provenance: monthSource }, fee: { ...verifiedPricing.fee, provenance: monthSource } };
  let monthGenerations: number = 0;
  const monthRuntime = { ...sdkRuntime, ...completion, now: (): number => monthClock, authenticate: async (): Promise<SiteIdentity> => monthOwner, requireSupport: async (): Promise<void> => {}, wait: async (): Promise<void> => { monthClock += 1000; }, warn: (): void => {}, fetch: async (input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> => {
    const req = new Request(input, init);
    if (req.url.endsWith("/responses/input_tokens")) return sdkRuntime.fetch(input, init);
    monthGenerations += 1;
    if (monthGenerations === 1) return Response.json({ error: { message: "month-boundary-fixture" } }, { status: 503 });
    return sdkRuntime.fetch(input, init);
  } };
  assert.equal((await runAiRequest(monthRuntime, { logicalRequestKey: "month-boundary", request, pricing: monthPricing, expectedKind: "diagnostic-question" }, new AbortController().signal)).kind, "validated");
  const months = await readAiRequestStatus(db, monthOwner, "month-boundary");
  assert.equal(months.length, 2); assert.equal(months[0].resetAt, months[1].periodStart);
  assert.equal(months[0].reservationState, "unknown"); assert.ok(months[0].outstandingReservedUnits > 0);
  assert.equal(months[1].reservationState, "settled");
  checks.push("seoul-month-boundary-new-attempt-new-window-old-unknown-retained");

  const cancelled = await fixture(db); const cancellation = new AbortController();
  const cancelRuntime = { ...sdkRuntime, authenticate: async (): Promise<SiteIdentity> => cancelled.owner, fetch: async (input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> => {
    const req = new Request(input, init);
    if (req.url.endsWith("/responses/input_tokens")) return sdkRuntime.fetch(input, init);
    cancellation.abort();
    throw new DOMException("fixture-cancelled", "AbortError");
  } };
  await assert.rejects(executeAiAttempt(cancelRuntime, { ...sdkInput, windowId: cancelled.input.windowId, logicalRequestKey: "cancelled" }, cancellation.signal));
  const cancelledStatus = await readAiRequestStatus(db, cancelled.owner, "cancelled");
  assert.equal(cancelledStatus[0].reservationState, "unknown"); assert.ok(cancelledStatus[0].outstandingReservedUnits > 0);
  checks.push("client-abort-after-dispatch-preserves-unknown-reservation");

  const concurrentSettlement = await received();
  const nextWindow = await windowRow(db, concurrentSettlement.current);
  const secondDelivery = await executeAiAttempt({ ...sdkRuntime, authenticate: async (): Promise<SiteIdentity> => concurrentSettlement.current.owner }, { ...sdkInput, windowId: concurrentSettlement.current.input.windowId, windowVersion: nextWindow.version, logicalRequestKey: "settlement-two" }, new AbortController().signal);
  if (secondDelivery.kind !== "received") throw new Error("두 번째 동시 정산 응답이 없습니다.");
  for (const item of [concurrentSettlement.delivery, secondDelivery]) await storeAiEvidence(db, item.owner, item.call.id, { facts: responseFacts(item.raw), providerRequestId: item.providerRequestId, httpStatus: item.status });
  const settledTogether = await Promise.all([concurrentSettlement.delivery, secondDelivery].map((item) => settleAiUsage(db, item.owner, item.call.id, now)));
  assert.equal((await windowRow(db, concurrentSettlement.current)).reserved_units, 0);
  assert.equal((await windowRow(db, concurrentSettlement.current)).settled_units, settledTogether.reduce((sum: number, item): number => sum + (item.actual?.units ?? 0), 0));
  checks.push("concurrent-distinct-settlements-cas-reconciled");
  const report: object = { status: "passed", runtime: "local-workerd-d1", checks, paidCalls: 0, hostedVerification: "not-run", checkedAt: new Date().toISOString() };
  await writeFile(".taskmaster/reports/task-4-cost-reservation.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  const retainedRevisions = await db.prepare("SELECT owner_id,revision FROM backup_revisions ORDER BY owner_id").all();
  const ledger = await runAiLedgerAcceptance(db, "local-workerd-d1");
  await assertNoVerificationRecords(db);
  await db.prepare("CREATE TRIGGER diagnostic_failure_fixture BEFORE INSERT ON ai_calls WHEN NEW.owner_id LIKE 'verification:%' BEGIN SELECT RAISE(ABORT,'diagnostic_failure_fixture'); END").run();
  await assert.rejects(runAiLedgerAcceptance(db, "local-workerd-d1"), (error: unknown): boolean => error instanceof Error && error.cause instanceof Error && error.cause.message.includes("diagnostic_failure_fixture"));
  await assertNoVerificationRecords(db);
  assert.deepEqual((await db.prepare("SELECT owner_id,revision FROM backup_revisions ORDER BY owner_id").all()).results, retainedRevisions.results);
  console.log(JSON.stringify({check:"ai-ledger-diagnostic-cleanup",successAndFailureAllOwnerTablesEmpty:true,otherOwnersPreserved:true}));
  await writeFile(".taskmaster/reports/task-4-ai-ledger-local.json", JSON.stringify(ledger, null, 2) + "\n");
  console.log(JSON.stringify(ledger));
} finally { await runtime.dispose(); }
