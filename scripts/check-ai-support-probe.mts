import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { fixturePricing } from "../tests/fixtures/ai-pricing.ts";
import { fixtureFunding, fixturePrepaidProbe } from "../tests/fixtures/ai-funding.ts";
import { emptyLearningContext } from "../tests/fixtures/ai-learning-context.ts";
import { runAiSupportProbe } from "../lib/ai/support-probe.ts";
import type { AiSupportProbeReport } from "../lib/ai/support-probe.ts";
import type { AiConfiguration } from "../lib/ai/configuration.ts";
import type { AiSequenceRuntime } from "../lib/ai/run.ts";
import type { ModelFetch } from "../lib/ai/client.ts";
import type { ModelRequest } from "../lib/ai/request-bound.ts";
import { runAiRequest } from "../lib/ai/run.ts";
import { reserveAiCost } from "../db/repositories/ai-cost.ts";
import { createCostWindow, reserveCost, seoulMonthWindow } from "../db/repositories/usage.ts";
import { prepareAiRequest, calculateRequestBound } from "../lib/ai/request-bound.ts";
import { recordId } from "../lib/domain/contracts.ts";
import { requireAiSupport } from "../lib/ai/support.ts";
import { executeAiStreamAttempt } from "../lib/ai/stream.ts";
import { readAiRequestStatus } from "../db/repositories/ai-status.ts";
import { currentAiWindow } from "../db/repositories/ai-window.ts";
import { checkAiFunding } from "../db/repositories/ai-funding.ts";
import type { SiteIdentity } from "../lib/domain/contracts.ts";

type Scenario = "normal" | "ended-early" | "wrong-limit" | "retry";
type Fixture = Readonly<{ owner: SiteIdentity; configuration: AiConfiguration; runtime: AiSequenceRuntime; requests: string[]; generations: string[] }>;
const now: number = Date.parse("2026-10-24T03:30:00Z");
const checks: string[] = [];
const local: Miniflare = new Miniflare({ modules: true, script: "export default {fetch() {return new Response('support-test');}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });

function fixture(db: D1Database, scenario: Scenario): Fixture {
  const owner: SiteIdentity = { realm: "sites", userId: `probe:${crypto.randomUUID()}` };
  const source = fixturePricing();
  const provenance = { source: "https://example.invalid/local-probe-fixture", checkedAt: now - 100, validFrom: now - 100, validUntil: now + 86_400_000, evidence: "verified" as const };
  const pricing = { ...source, pricing: { ...source.pricing, provenance }, exchange: { ...source.exchange, provenance }, tax: { ...source.tax, provenance }, fee: { ...source.fee, provenance } };
  const configuration: AiConfiguration = { pricing, funding: fixtureFunding(owner.userId, pricing.id, now), support: [] };
  const requests: string[] = [];
  const generations: string[] = [];
  const responses: Map<string, object> = new Map();
  const fetch: ModelFetch = async (input, init): Promise<Response> => {
    const request: Request = new Request(input, init);
    assert.ok(request.url.startsWith("https://api.openai.com/v1/"));
    assert.equal(request.headers.get("authorization"), "Bearer fixture-only-not-a-secret");
    requests.push(request.url);
    if (request.url.endsWith("/responses/input_tokens")) return Response.json({ input_tokens: 1000 }, { headers: { "x-request-id": "req_count_fixture" } });
    if (request.method === "GET") {
      const saved: object | undefined = responses.get(`${new URL(request.url).origin}${new URL(request.url).pathname}`);
      assert.ok(saved, "저장된 응답 ID만 조회해야 합니다.");
      return Response.json(saved, { headers: { "x-request-id": "req_recovery_fixture" } });
    }
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    const raw: string = await request.text();
    generations.push(raw);
    if (scenario === "retry" && generations.length <= 2) return Response.json({ error: { message: "모의 일시 장애", type: "server_error", code: "server_error" } }, { status: 503 });
    const body = JSON.parse(raw) as { stream: boolean; model: string; tools: unknown[]; max_output_tokens: number; input: { content: { type: string; text?: string }[] }[] };
    assert.equal(body.model, "gpt-6-luna"); assert.deepEqual(body.tools, []);
    const content = body.input[0].content;
    const answer: string = content.some((part): boolean => part.type === "input_image") ? "red" : content[0].text?.replace("Test answer: ", "") ?? "invalid";
    const response = { id: `resp_${crypto.randomUUID()}`, model: body.model, object: "response", created_at: 1, status: "completed", max_output_tokens: scenario === "wrong-limit" ? 1 : body.max_output_tokens,
      output: [{ type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ result: { kind: "diagnostic-question", question: answer, waitForAnswer: true } }), annotations: [] }] }],
      usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 32, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1032 } };
    responses.set(`https://api.openai.com/v1/responses/${response.id}`, response);
    if (!body.stream) return Response.json(response, { headers: { "x-request-id": "req_response_fixture" } });
    const created: string = `event: response.created\ndata: ${JSON.stringify({ type: "response.created", sequence_number: 0, response: { ...response, status: "in_progress", output: [], usage: null } })}\n\n`;
    const completed: string = `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", sequence_number: 1, response })}\n\n`;
    return new Response(created + (scenario === "ended-early" ? "" : completed) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream", "x-request-id": "req_stream_fixture" } });
  };
  const runtime: AiSequenceRuntime = { db, authenticate: async (): Promise<SiteIdentity> => owner, authorizeSources: async (): Promise<void> => { throw new Error("일반 사용자 자료 경로로 검사 이미지를 우회하면 안 됩니다."); }, checkFunding: (current, bound, time) => checkAiFunding(db, current, bound, configuration.funding, time), readApiKey: (): string => "fixture-only-not-a-secret", now: (): number => now, fetch, loadContext: async () => emptyLearningContext(), wait: async (): Promise<void> => {}, warn: (warning): void => { throw new Error(`예상하지 않은 재시도: ${warning.event}`); } };
  return { owner, configuration, runtime, requests, generations };
}

try {
  const db: D1Database = await local.getD1Database("DB") as unknown as D1Database;
  const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const sql of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((value: string): string => value.trim()).filter(Boolean)) await db.prepare(sql).run();
  const normal = fixture(db, "normal");
  const report: AiSupportProbeReport = await runAiSupportProbe(normal.runtime, normal.configuration, "local-mock", new AbortController().signal);
  assert.equal(report.status, "passed"); assert.equal(report.checks.length, 4); assert.equal(report.observations.length, 6); assert.equal(normal.generations.length, 4);
  for (const check of report.checks.slice(0, 3)) { assert.equal(check.attempts[0].reservationState, "settled"); assert.equal(check.attempts[0].stage, "validated"); assert.ok(check.attempts[0].actualUnits! > 0); }
  const interrupted = report.checks[3].attempts[0];
  assert.equal(interrupted.stage, "unknown"); assert.equal(interrupted.reservationState, "unknown"); assert.ok(interrupted.responseId?.startsWith("resp_")); assert.ok(interrupted.outstandingReservedUnits > 0); assert.equal(interrupted.automaticReplayAllowed, false);
  checks.push("fixed-text-image-structured-output-usage-limit-stream-all-use-reserved-path");
  checks.push("stream-created-id-persisted-before-abort-unknown-reservation-retained");
  const beforeReplay: number = normal.requests.length;
  assert.deepEqual(await runAiSupportProbe(normal.runtime, normal.configuration, "local-mock", new AbortController().signal), report);
  assert.equal(normal.requests.length, beforeReplay); checks.push("replayed-support-check-no-new-count-or-generation");
  assert.throws(() => requireAiSupport(report.observations, ["text", "image", "streaming"], normal.configuration.funding.accountFingerprint, now), { code: "ai_support_unverified" });
  checks.push("mock-observations-never-unlock-hosted-learning");

  for (const scenario of ["auto-recharge", "monthly-payment", "wrong-owner", "expired", "unverified-pricing"] as const) {
    const current = fixture(db, "normal");
    const configuration = scenario === "auto-recharge" ? { ...current.configuration, funding: { ...current.configuration.funding, automaticRecharge: true } } :
      scenario === "monthly-payment" ? { ...current.configuration, funding: { ...current.configuration.funding, payments: [{ id: "too-large", kind: "credit-topup", units: 10_001_000_000, paidAt: now }] } } :
      scenario === "wrong-owner" ? { ...current.configuration, funding: { ...current.configuration.funding, ownerId: "other-owner" } } :
      scenario === "expired" ? { ...current.configuration, funding: { ...current.configuration.funding, checkedAt: now - 2, validUntil: now - 1 } } :
      { ...current.configuration, pricing: { ...current.configuration.pricing, exchange: { ...current.configuration.pricing.exchange, provenance: { ...current.configuration.pricing.exchange.provenance, evidence: "fixture" } } } };
    await assert.rejects(runAiSupportProbe(current.runtime, configuration as AiConfiguration, "local-mock", new AbortController().signal));
    assert.equal(current.requests.length, 0, scenario);
  }
  checks.push("unverified-funding-pricing-autorecharge-monthly-payment-rejected-before-network");

  const cap = fixture(db, "normal");
  const expensive: AiConfiguration = { ...cap.configuration, pricing: { ...cap.configuration.pricing, exchange: { ...cap.configuration.pricing.exchange, krwPerUsd: "10000000" } } };
  await assert.rejects(runAiSupportProbe(cap.runtime, expensive, "local-mock", new AbortController().signal), { operation: "ai.probe.ten-won-attempt-cap" });
  assert.equal(cap.generations.length, 0); checks.push("probe-ten-won-attempt-cap-before-generation");

  const wrongLimit = fixture(db, "wrong-limit");
  await assert.rejects(runAiSupportProbe(wrongLimit.runtime, wrongLimit.configuration, "local-mock", new AbortController().signal));
  assert.equal(wrongLimit.generations.length, 1);
  const wrongState = await db.prepare("SELECT c.stage,r.state,r.actual_units FROM ai_calls c JOIN cost_reservations r ON r.owner_id=c.owner_id AND r.id=c.id WHERE c.owner_id=?").bind(wrongLimit.owner.userId).first();
  assert.equal(wrongState?.stage, "invalid"); assert.equal(wrongState?.state, "settled"); assert.ok(Number(wrongState?.actual_units) > 0);
  checks.push("output-limit-mismatch-settles-usage-before-rejecting-evidence");

  for (const scenario of ["normal", "wrong-limit"] as const) {
    const recovering = fixture(db, scenario);
    await db.prepare("CREATE TRIGGER inject_probe_settlement_failure BEFORE UPDATE ON cost_reservations WHEN NEW.state = 'settled' BEGIN SELECT RAISE(ABORT,'injected_settlement_failure'); END").run();
    await assert.rejects(runAiSupportProbe(recovering.runtime, recovering.configuration, "local-mock", new AbortController().signal));
    assert.equal(recovering.generations.length, 1);
    await db.prepare("DROP TRIGGER inject_probe_settlement_failure").run();
    if (scenario === "normal") {
      assert.equal((await runAiSupportProbe(recovering.runtime, recovering.configuration, "local-mock", new AbortController().signal)).status, "passed");
      assert.equal(recovering.generations.length, 4);
    } else {
      await assert.rejects(runAiSupportProbe(recovering.runtime, recovering.configuration, "local-mock", new AbortController().signal));
      assert.equal(recovering.generations.length, 1);
    }
    assert.equal(recovering.requests.filter((url): boolean => /\/responses\/resp_/.test(url)).length, 1);
  }
  checks.push("saved-response-only-recovery-settles-without-duplicate-generation");
  checks.push("recovered-response-output-limit-still-validated");

  const early = fixture(db, "ended-early");
  const window = await currentAiWindow(db, early.owner, now);
  const request: ModelRequest = { instructions: "검사", messages: [{ role: "user", content: [{ type: "input_text", text: "Test answer: EARLY" }] }], maximumOutputTokens: 512, reasoningEffort: "none" };
  const input = { logicalRequestKey: "early-stream", attemptOrdinal: 1, windowId: window.id, windowVersion: window.version, request, pricing: early.configuration.pricing };
  const earlyRuntime = { ...early.runtime, authorizeSources: async (): Promise<void> => {} };
  await assert.rejects(executeAiStreamAttempt(earlyRuntime, input, new AbortController().signal), { code: "ai_transport_failed" });
  const states = await readAiRequestStatus(db, early.owner, input.logicalRequestKey);
  assert.equal(states[0].stage, "unknown"); assert.ok(states[0].responseId); assert.ok(states[0].outstandingReservedUnits > 0);
  const earlyRequests: number = early.requests.length;
  assert.equal((await executeAiStreamAttempt(earlyRuntime, input, new AbortController().signal)).kind, "existing");
  assert.equal(early.requests.length, earlyRequests); checks.push("stream-without-terminal-usage-retains-id-and-never-replays");
  const pendingBase = fixture(db, "retry");
  const pendingConfiguration: AiConfiguration = { ...pendingBase.configuration, ...fixturePrepaidProbe(pendingBase.configuration.funding, pendingBase.configuration.pricing) };
  const warnings: string[] = [];
  const pendingRuntime: AiSequenceRuntime = { ...pendingBase.runtime, checkFunding: (current, bound, time) => checkAiFunding(db, current, bound, pendingConfiguration.funding, time), warn: (warning): void => { warnings.push(warning.event); } };
  const pendingReport = await runAiSupportProbe(pendingRuntime, pendingConfiguration, "local-mock", new AbortController().signal);
  assert.equal(pendingReport.checks[0].attempts.length, 3); assert.equal(warnings.length, 2); assert.equal(pendingBase.generations.length, 6);
  const totalUsd = async (): Promise<number> => Number(await db.prepare("SELECT sum(json_extract(snapshot,'$.reservationUsdMicros')) AS total FROM ai_funding_checks WHERE owner_id=?").bind(pendingBase.owner.userId).first<number>("total"));
  const heldUsd: number = await totalUsd(); assert.equal(heldUsd, 6 * 506);
  await runAiSupportProbe(pendingRuntime, pendingConfiguration, "local-mock", new AbortController().signal);
  assert.equal(await totalUsd(), heldUsd); assert.equal(pendingBase.generations.length, 6);
  checks.push("prepaid-retries-settlement-abort-and-replay-never-refund-usd-reservations");
  const countBeforeGeneral: number = pendingBase.requests.length;
  await assert.rejects(runAiRequest({ ...pendingRuntime, requireSupport: async (): Promise<void> => {} }, { logicalRequestKey: "general-denied", request: { instructions: "검사", messages: [{ role: "user", content: [{ type: "input_text", text: "질문" }] }], maximumOutputTokens: 512, reasoningEffort: "none" }, pricing: pendingConfiguration.pricing, expectedKind: "diagnostic-question" }, new AbortController().signal), { code: "ai_pricing_invalid" });
  assert.equal(pendingBase.requests.length, countBeforeGeneral);
  checks.push("provisional-pricing-never-unlocks-general-learning");
  const operationsWindow = recordId.parse(crypto.randomUUID());
  await createCostWindow(db, { owner: pendingBase.owner, requestKey: "operations-window", expectedVersion: 1 }, { id: operationsWindow, category: "operations", ...seoulMonthWindow(now) });
  await assert.rejects(reserveCost(db, { owner: pendingBase.owner, requestKey: "new-payment", expectedVersion: 1 }, { id: recordId.parse(crypto.randomUUID()), windowId: operationsWindow, businessKey: "new-payment", model: "operations", amountUnits: 1, now }));
  assert.equal(await db.prepare("SELECT reserved_units FROM cost_windows WHERE id=?").bind(operationsWindow).first<number>("reserved_units"), 0);
  checks.push("pending-invoice-reserves-full-month-and-blocks-new-paid-operations");
  const prepared = await prepareAiRequest({ instructions: "원장 경계 검사", messages: [{ role: "user", content: [{ type: "input_text", text: "검사" }] }], maximumOutputTokens: 512, reasoningEffort: "none" });
  const bound = await calculateRequestBound(prepared, { requestFingerprint: prepared.requestFingerprint, model: "gpt-6-luna", inputTokens: 100_000, providerRequestId: "req_boundary", checkedAt: now }, pendingConfiguration.pricing, now);
  const funding = await checkAiFunding(db, pendingBase.owner, bound, pendingConfiguration.funding, now);
  const currentWindow = await currentAiWindow(db, pendingBase.owner, now);
  const costInput = { id: crypto.randomUUID(), windowId: currentWindow.id, scope: "probe-boundary", now, prepared, bound, pricing: pendingConfiguration.pricing, funding };
  const context = { owner: pendingBase.owner, requestKey: "boundary-1", expectedVersion: currentWindow.version };
  const race = await Promise.allSettled([reserveAiCost(db, context, costInput), reserveAiCost(db, { ...context, requestKey: "boundary-2" }, { ...costInput, id: crypto.randomUUID() })]);
  assert.equal(race.filter((value): boolean => value.status === "fulfilled").length, 1);
  const afterRace = await currentAiWindow(db, pendingBase.owner, now);
  await assert.rejects(reserveAiCost(db, { ...context, requestKey: "boundary-stale-funding", expectedVersion: afterRace.version }, { ...costInput, id: crypto.randomUUID() }));
  await assert.rejects(checkAiFunding(db, pendingBase.owner, bound, { ...pendingConfiguration.funding, id: recordId.parse(crypto.randomUUID()), reconciledReservationIds: pendingReport.checks.slice(0, 3).map((check) => recordId.parse(check.attempts.at(-1)!.callId)) }, now));
  assert.equal(await totalUsd(), heldUsd + 25_256); assert.ok(await totalUsd() <= 50_000);
  checks.push("five-cent-cap-atomic-race-stale-funding-config-id-and-reconciliation-cannot-reset");
  const forged = { ...bound, amount: { ...bound.amount, exactUsd: { numerator: "0", denominator: "1" } } };
  await assert.rejects(reserveAiCost(db, { ...context, requestKey: "forged", expectedVersion: afterRace.version }, { ...costInput, id: crypto.randomUUID(), bound: forged }), { code: "ai_bound_unavailable" });
  checks.push("forged-usd-bound-rejected-before-ledger-insert");
  const exactBound = await calculateRequestBound(prepared, { requestFingerprint: prepared.requestFingerprint, model: "gpt-6-luna", inputTokens: 85_808, providerRequestId: "req_exact", checkedAt: now }, pendingConfiguration.pricing, now);
  const exactFunding = await checkAiFunding(db, pendingBase.owner, exactBound, pendingConfiguration.funding, now);
  await reserveAiCost(db, { ...context, requestKey: "exact-five-cent", expectedVersion: afterRace.version }, { ...costInput, id: crypto.randomUUID(), bound: exactBound, funding: exactFunding });
  assert.equal(await totalUsd(), 50_000);
  await assert.rejects(checkAiFunding(db, pendingBase.owner, bound, pendingConfiguration.funding, now), { operation: "ai.probe.cumulative-cap" });
  checks.push("exact-five-cent-boundary-accepted-and-any-further-reservation-denied");

  assert.ok(pendingConfiguration.funding.prepaidProbe);
  const increasedFunding = { ...pendingConfiguration.funding, id: recordId.parse(crypto.randomUUID()), prepaidProbe: { ...pendingConfiguration.funding.prepaidProbe, limitUsdMicros: 80_000 as const } };
  const remainingBound = await calculateRequestBound(prepared, { requestFingerprint: prepared.requestFingerprint, model: "gpt-6-luna", inputTokens: 118_976, providerRequestId: "req_eight_cent", checkedAt: now }, pendingConfiguration.pricing, now);
  const increasedCheck = await checkAiFunding(db, pendingBase.owner, remainingBound, increasedFunding, now);
  const increasedWindow = await currentAiWindow(db, pendingBase.owner, now);
  const increasedInput = { ...costInput, id: crypto.randomUUID(), bound: remainingBound, funding: increasedCheck };
  const increasedContext = { ...context, requestKey: "eight-cent-1", expectedVersion: increasedWindow.version };
  const increasedRace = await Promise.allSettled([reserveAiCost(db, increasedContext, increasedInput), reserveAiCost(db, { ...increasedContext, requestKey: "eight-cent-2" }, { ...increasedInput, id: crypto.randomUUID() })]);
  assert.equal(increasedRace.filter((value): boolean => value.status === "fulfilled").length, 1);
  assert.equal(await totalUsd(), 80_000);
  await assert.rejects(checkAiFunding(db, pendingBase.owner, bound, increasedFunding, now), { operation: "ai.probe.cumulative-cap" });
  await assert.rejects(checkAiFunding(db, pendingBase.owner, bound, pendingConfiguration.funding, now), { operation: "ai.probe.cumulative-cap" });
  const afterIncrease = await currentAiWindow(db, pendingBase.owner, now);
  await assert.rejects(reserveAiCost(db, { ...increasedContext, requestKey: "eight-cent-stale", expectedVersion: afterIncrease.version }, { ...increasedInput, id: crypto.randomUUID() }));
  await assert.rejects(checkAiFunding(db, pendingBase.owner, bound, { ...increasedFunding, id: recordId.parse(crypto.randomUUID()), reconciledReservationIds: pendingReport.checks.slice(0, 3).map((check) => recordId.parse(check.attempts.at(-1)!.callId)) }, now), { operation: "ai.probe.cumulative-cap" });
  assert.equal(await totalUsd(), 80_000);
  checks.push("approved-eight-cent-cap-keeps-five-cent-history-unknowns-and-atomic-boundary");

  const thirtyFunding = { ...increasedFunding, id: recordId.parse(crypto.randomUUID()), prepaidProbe: { ...increasedFunding.prepaidProbe, limitUsdMicros: 300000 as const } };
  const thirtyBound = await calculateRequestBound(prepared, { requestFingerprint: prepared.requestFingerprint, model: "gpt-6-luna", inputTokens: 439232, providerRequestId: "req_thirty_cent", checkedAt: now }, pendingConfiguration.pricing, now);
  const thirtyChecked = await checkAiFunding(db, pendingBase.owner, thirtyBound, thirtyFunding, now);
  await reserveAiCost(db, { ...context, requestKey: "thirty-cent-boundary", expectedVersion: afterIncrease.version }, { ...costInput, id: crypto.randomUUID(), bound: thirtyBound, funding: thirtyChecked });
  assert.equal(await totalUsd(), 300000);
  await assert.rejects(checkAiFunding(db, pendingBase.owner, bound, thirtyFunding, now), { operation: "ai.probe.cumulative-cap" });
  checks.push("approved-thirty-cent-cap-retains-all-earlier-reservations-and-blocks-overage");

  const coffee = fixture(db, "normal");
  const coffeeBase = fixturePrepaidProbe(coffee.configuration.funding, coffee.configuration.pricing);
  const coffeeFunding = { ...coffeeBase.funding, prepaidProbe: { ...coffeeBase.funding.prepaidProbe!, limitUsdMicros: 300000 as const } };
  const coffeeBound = await calculateRequestBound(prepared, { requestFingerprint: prepared.requestFingerprint, model: "gpt-6-luna", inputTokens: 1000, providerRequestId: "req_coffee_bound", checkedAt: now }, coffeeBase.pricing, now);
  const coffeeCheck = await checkAiFunding(db, coffee.owner, coffeeBound, coffeeFunding, now);
  const approvalId = recordId.parse(crypto.randomUUID()); const unitId = recordId.parse(crypto.randomUUID());
  async function coffeeReservation(key: string, version: number, stage: string, unit: typeof unitId, kind: "page-vision" | "tutor-lesson"): Promise<void> {
    const active = await currentAiWindow(db, coffee.owner, now);
    await reserveAiCost(db, { owner: coffee.owner, requestKey: key, expectedVersion: version }, { id: crypto.randomUUID(), windowId: active.id, scope: "coffee-fixture", now, prepared, bound: coffeeBound, pricing: coffeeBase.pricing, funding: { ...coffeeCheck, coffeeProbe: { approvalId, logicalRequestKey: stage, requestFingerprint: prepared.requestFingerprint, unitId: unit, kind } } });
  }
  for (let i: number = 0; i < 30; i += 1) await coffeeReservation(`stage-${i}`, (await currentAiWindow(db, coffee.owner, now)).version, `stage-${i}`, unitId, i < 10 ? "page-vision" : "tutor-lesson");
  const finalSlot = await currentAiWindow(db, coffee.owner, now);
  const lastStage = await Promise.allSettled([coffeeReservation("stage-30", finalSlot.version, "stage-30", unitId, "tutor-lesson"), coffeeReservation("stage-31", finalSlot.version, "stage-31", unitId, "tutor-lesson")]);
  assert.equal(lastStage.filter(item => item.status === "fulfilled").length, 1);
  await assert.rejects(coffeeReservation("stage-32", (await currentAiWindow(db, coffee.owner, now)).version, "stage-32", unitId, "tutor-lesson"));
  await assert.rejects(coffeeReservation("other-unit", (await currentAiWindow(db, coffee.owner, now)).version, "stage-8", recordId.parse(crypto.randomUUID()), "tutor-lesson"));
  await coffeeReservation("retry-1", (await currentAiWindow(db, coffee.owner, now)).version, "stage-0", unitId, "page-vision");
  await coffeeReservation("retry-2", (await currentAiWindow(db, coffee.owner, now)).version, "stage-0", unitId, "page-vision");
  await assert.rejects(coffeeReservation("retry-3", (await currentAiWindow(db, coffee.owner, now)).version, "stage-0", unitId, "page-vision"));
  const coffeeTotals = await db.prepare("SELECT count(*) AS attempts,count(DISTINCT json_extract(snapshot,'$.coffeeProbe.logicalRequestKey')) AS stages FROM ai_funding_checks WHERE owner_id=?").bind(coffee.owner.userId).first();
  assert.deepEqual(coffeeTotals, { attempts: 33, stages: 31 });
  checks.push("coffee-thirty-one-stages-ten-vision-twenty-one-learning-atomic-final-slot-one-unit-and-two-retries-maximum");

  const result = { status: "passed", environment: "local-workerd-d1-mocked-openai", paidCalls: 0, checks, checkedAt: new Date().toISOString() };
  await writeFile(".taskmaster/reports/task-4-support-probe-local.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally { await local.dispose(); }
