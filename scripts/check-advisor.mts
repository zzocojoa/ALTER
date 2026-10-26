import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { startAdvisor, beginStoredAdvisorAi, submitAdvisorAnswer, getAdvisor, confirmAdvisorPlan, editStoredAdvisorPlan } from "../db/repositories/advisor.ts";
import { advisorContext, processAdvisorAi, dispatchAdvisor } from "../lib/advisor/ai.ts";
import { learningConditions } from "../lib/advisor/conditions.ts";
import type { AdvisorState, AdvisorTurn, AdvisorPlan } from "../lib/advisor/contracts.ts";
import type { Command, SiteIdentity } from "../lib/domain/contracts.ts";
import type { AiRunRuntime } from "../lib/ai/run.ts";
import { checkAiFunding } from "../db/repositories/ai-funding.ts";
import { fixturePricing } from "../tests/fixtures/ai-pricing.ts";
import { fixtureFunding } from "../tests/fixtures/ai-funding.ts";
import type { PricingVersion } from "../lib/ai/pricing.ts";

const mf: Miniflare = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('advisor-test')}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
const checks: string[] = [];

try {
  const db: D1Database = await mf.getD1Database("DB") as unknown as D1Database;
  const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) for (const statement of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((sql: string): string => sql.trim()).filter(Boolean)) await db.prepare(statement).run();
  const now: number = Date.now(); const base = fixturePricing();
  const provenance = { ...base.pricing.provenance, evidence: "verified" as const, checkedAt: now - 1000, validFrom: now - 1000, validUntil: now + 3600000 };
  const pricing: PricingVersion = { ...base, pricing: { ...base.pricing, provenance }, exchange: { ...base.exchange, provenance }, tax: { ...base.tax, provenance }, fee: { ...base.fee, provenance } };
  for (const scenario of ["major", "certification", "practical", "no-credit", "network-unknown", "invalid-evidence", "429-retry", "saved-ai-before-d1-failure"]) {
    const owner: SiteIdentity = { realm: "sites", userId: `advisor-fixture:${crypto.randomUUID()}` }; const id: string = crypto.randomUUID();
    const conditions = learningConditions.parse({ title: `${scenario} 시험`, domain: ["major", "certification", "practical"].includes(scenario) ? scenario : "major", purpose: "비율을 설명하고 계산", selfReportedLevel: "초보", minutesPerWeek: 60, startDate: "2026-10-24", endDate: "2026-10-30", excludedScope: ["미적분"] });
    const command = (expectedVersion: number): Command => ({ owner, expectedVersion, requestKey: crypto.randomUUID() });
    const start = command(1); await startAdvisor(db, start, id, conditions); await startAdvisor(db, start, id, conditions);
    assert.equal((await getAdvisor(db, owner, id)).version, 1);
    await assert.rejects(getAdvisor(db, { realm: "sites", userId: "other" }, id));
    let generations: number = 0; let retrievals: number = 0;
    const execution: AiRunRuntime = { db, authenticate: async () => owner, readApiKey: (): string => "fixture-only-not-a-real-key", now: (): number => now, loadContext: async () => advisorContext(await getAdvisor(db, owner, id)), requireSupport: async (): Promise<void> => {}, wait: async (): Promise<void> => {}, warn: (): void => {}, authorizeSources: async (_current, request): Promise<void> => { assert.equal(request.imageCount, 0); assert.equal(request.body.model, "gpt-6-luna"); }, checkFunding: async (current, bound, checkedAt) => { const funding = fixtureFunding(current.userId, pricing.id, checkedAt); return checkAiFunding(db, current, bound, scenario === "no-credit" ? { ...funding, creditAvailableUnits: 0 } : funding, checkedAt); }, fetch: async (input, init): Promise<Response> => {
      const request: Request = new Request(input, init);
      if (request.method === "GET") { retrievals += 1; throw new Error("unexpected retrieval in fixture"); }
      const body = JSON.parse(await request.text()) as { max_output_tokens?: number };
      if (request.url.endsWith("/input_tokens")) return Response.json({ input_tokens: 1000 }, { headers: { "x-request-id": "req_count" } });
      generations += 1;
      if (scenario === "network-unknown") throw new TypeError("fixture network reset");
      if (scenario === "429-retry" && generations === 1) return Response.json({ error: { code: "rate_limit_exceeded", message: "fixture" } }, { status: 429, headers: { "retry-after": "0", "x-request-id": "req_rate" } });
      const state: AdvisorState = await getAdvisor(db, owner, id); const last = state.answers.at(-1); const count: number = state.answers.length;
      const output: AdvisorTurn | AdvisorPlan = state.pending?.kind === "advisor-turn" ? { kind: "advisor-turn", evaluation: last ? { answerId: last.id, quote: scenario === "invalid-evidence" ? "존재하지 않는 근거" : last.text, interpretation: "제출한 답변의 초기 추정", unverified: ["독립 수행"], category: "diagnostic-estimate" } : null, question: count === 2 ? null : { mode: count === 0 ? "explanation" : "performance", prompt: count === 0 ? "비율을 설명해 주세요." : "물 100mL에 소금 10g을 섞었을 때 물 200mL에는 얼마가 필요한가요?" }, readyForPlan: count === 2 } : { kind: "advisor-plan", requiresConfirmation: true, proposal: { objective: "비율 이해", prerequisites: ["곱셈"], units: [{ key: "ratio", title: "비율", objective: "비율 이해", prerequisiteKeys: [], minutes: 60, selfExplanationCriterion: "비율의 의미 설명", newConditionCriterion: "새 농도의 혼합 계산" }], excludedScope: ["미적분"], attention: ["진단만으로 독립 수행 미확인"] } };
      return Response.json({ id: `resp_fixture_${generations}`, model: "gpt-6-luna", object: "response", created_at: 1, status: "completed", max_output_tokens: body.max_output_tokens, output: [{ type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ result: output }), annotations: [] }] }], usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, cache_write_tokens_details: { ttl_30m_tokens: 0, ttl_12h_tokens: 0 } }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1200 } }, { headers: { "x-request-id": `req_${generations}` } });
    } };
    async function generate(): Promise<AdvisorState> { const state = await getAdvisor(db, owner, id); const cmd = command(state.version); await beginStoredAdvisorAi(db, cmd, id); await beginStoredAdvisorAi(db, cmd, id); return processAdvisorAi(execution, owner, id, pricing, dispatchAdvisor, new AbortController().signal); }
    if (["no-credit", "network-unknown"].includes(scenario)) {
      await assert.rejects(generate()); const stored = await getAdvisor(db, owner, id); assert.ok(stored.pending); assert.equal(stored.question, null); assert.equal(stored.version, 2);
      const before: number = generations; await assert.rejects(processAdvisorAi(execution, owner, id, pricing, dispatchAdvisor, new AbortController().signal)); assert.equal(generations, before); assert.equal(generations, scenario === "no-credit" ? 0 : 3); checks.push(scenario); continue;
    }
    if (scenario === "saved-ai-before-d1-failure") {
      await db.prepare("CREATE TRIGGER fail_advisor_turn BEFORE INSERT ON advisor_events WHEN NEW.kind='turn' BEGIN SELECT RAISE(ABORT,'fixture_turn_write_failure'); END;").run();
      await assert.rejects(generate()); assert.equal(generations, 1); assert.ok((await getAdvisor(db, owner, id)).pending);
      await db.prepare("DROP TRIGGER fail_advisor_turn").run();
    }
    let state = scenario === "saved-ai-before-d1-failure" ? await processAdvisorAi(execution, owner, id, pricing, dispatchAdvisor, new AbortController().signal) : await generate(); assert.equal(state.question?.mode, "explanation"); assert.equal(state.answers.length, 0);
    const firstQuestion = state.question; assert.ok(firstQuestion);
    const firstAnswer = { questionId: firstQuestion.id, text: "전체에 대한 부분의 크기입니다.", materialUsed: true, hintUsed: true, answerSeen: true };
    const answerCmd = command(state.version); await Promise.all([submitAdvisorAnswer(db, answerCmd, id, firstAnswer), submitAdvisorAnswer(db, answerCmd, id, firstAnswer)]); await submitAdvisorAnswer(db, answerCmd, id, firstAnswer);
    await assert.rejects(submitAdvisorAnswer(db, { ...answerCmd, requestKey: crypto.randomUUID() }, id, firstAnswer));
    await assert.rejects(submitAdvisorAnswer(db, answerCmd, id, { ...firstAnswer, text: "변조" }));
    if (scenario === "invalid-evidence") { await assert.rejects(generate()); state = await getAdvisor(db, owner, id); assert.equal(state.answers.length, 1); assert.equal(state.estimates.length, 0); assert.equal(state.question, null); checks.push(scenario); continue; }
    state = await generate(); assert.equal(state.question?.mode, "performance"); assert.ok(state.question); assert.equal(state.estimates.length, 1);
    await submitAdvisorAnswer(db, command(state.version), id, { questionId: state.question.id, text: "20g입니다. 물이 두 배이므로 소금도 두 배입니다.", materialUsed: false, hintUsed: false, answerSeen: false });
    state = await generate(); assert.equal(state.phase, "planning"); assert.equal(state.question, null);
    state = await generate(); assert.equal(state.phase, "draft"); assert.ok(state.draft); assert.equal(state.answers[0].hintUsed, true);
    const count: number = generations; await processAdvisorAi(execution, owner, id, pricing, dispatchAdvisor, new AbortController().signal); assert.equal(generations, count);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM plans WHERE owner_id=?").bind(owner.userId).first<number>("n"), 0);
    const editCmd = command(state.version); await editStoredAdvisorPlan(db, editCmd, id, { ...state.draft, objective: "수정한 목표", units: [{ ...state.draft.units[0], minutes: 61 }] });
    const over = await getAdvisor(db, owner, id); const overChoices = { reviewedVersion: over.version, reviewedEvidence: true as const, acceptedAssessment: true as const, acceptedScopeAndTime: true as const }; await assert.rejects(confirmAdvisorPlan(db, command(over.version), id, overChoices));
    await editStoredAdvisorPlan(db, command(over.version), id, { ...state.draft, objective: "수정한 목표" }); state = await getAdvisor(db, owner, id);
    const confirmCmd = command(state.version); const choices = { reviewedVersion: state.version, reviewedEvidence: true as const, acceptedAssessment: true as const, acceptedScopeAndTime: true as const };
    await db.prepare("CREATE TRIGGER fail_advisor_fixture BEFORE INSERT ON plan_versions BEGIN SELECT RAISE(ABORT,'fixture_interrupted_confirmation'); END;").run();
    await assert.rejects(confirmAdvisorPlan(db, confirmCmd, id, choices)); assert.equal((await getAdvisor(db, owner, id)).version, state.version); assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM courses WHERE owner_id=?").bind(owner.userId).first<number>("n"), 0);
    await db.prepare("DROP TRIGGER fail_advisor_fixture").run();
    await confirmAdvisorPlan(db, confirmCmd, id, choices); await confirmAdvisorPlan(db, confirmCmd, id, choices);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM plan_versions WHERE owner_id=?").bind(owner.userId).first<number>("n"), 1);
    assert.equal((await getAdvisor(db, owner, id)).phase, "confirmed");
    await assert.rejects(db.prepare("UPDATE advisor_events SET content='{}' WHERE owner_id=?").bind(owner.userId).run());
    await assert.rejects(db.prepare("DELETE FROM advisor_events WHERE owner_id=?").bind(owner.userId).run());
    await assert.rejects(db.prepare("UPDATE advisor_sessions SET version=version+1,state=json_set(state,'$.version',version+1,'$.answers',json('[]')) WHERE owner_id=?").bind(owner.userId).run());
    assert.equal(retrievals, 0); checks.push(`${scenario}: sequential answers, resume, ownership, immutable exposure, duplicate, stale, edit, budget, atomic rollback, confirmation`);
  }
  await writeFile(".taskmaster/reports/task-7-local.json", JSON.stringify({ status: "passed", environment: "local-d1-real-openai-sdk-mock-transport", actualProviderCalls: 0, checks }, null, 2)+"\n"); console.log(JSON.stringify({ status: "passed", checks }));
} finally { await mf.dispose(); }
