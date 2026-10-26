import { usdReservationMicros } from "../../lib/ai/pricing";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { runAiRequest } from "../../lib/ai/run";
import { checkAiFunding, probeReservationChecks } from "../../db/repositories/ai-funding";
import { learningRuntimeFixture } from "../fixtures/learning-ai-runtime";
import { tutorLessonFixture } from "../fixtures/tutor-state";
import { describe, expect, it } from "vitest";
import { coffeeProbeApproval, coffeeProbeUnit, requireCoffeePage, requireCoffeeBound } from "../../lib/ai/coffee-probe";
import { fundingSnapshot } from "../../lib/ai/funding";
import { prepareAiRequest, calculateRequestBound } from "../../lib/ai/request-bound";
import type { ModelRequest } from "../../lib/ai/request-bound";
import { tutorContext } from "../../lib/tutor/ai";
import { emptyLearningContext } from "../fixtures/ai-learning-context";
import { tutorStateFixture, tutorId } from "../fixtures/tutor-state";
import { fixturePricing } from "../fixtures/ai-pricing";
import { fixtureFunding, fixturePrepaidProbe } from "../fixtures/ai-funding";
import { projectBackupRow, validateBackupRow } from "../../lib/backup/contracts";

const approval = coffeeProbeApproval.parse({ id: tutorId(3000), courseId: tutorId(4), approvedAt: 1, validUntil: 100, pages: [8, 80, 81, 82].map(n => ({ materialId: tutorId(n), originalHash: "a".repeat(64), filePage: 1 })) });
const binding = { ...approval.pages[0], originalVersion: "fixture-v1", selectionRevision: 1, imageSha256: "b".repeat(64), width: 100, height: 100, rotation: 0 as const };
const request: ModelRequest = { instructions: "합성 검증", messages: [{ role: "user", content: [{ type: "input_text", text: "검사" }] }], maximumOutputTokens: 1400, reasoningEffort: "none", responseContract: "tutor-lesson" };

describe("커피 네 페이지·한 과정 승인", () => {
  it("정확한 원본·페이지·유효기간만 허용한다", () => {
    expect(() => requireCoffeePage(approval, binding, 10)).not.toThrow();
    for (const changed of [{ ...binding, originalHash: "c".repeat(64) }, { ...binding, materialId: tutorId(99) }, { ...binding, filePage: 2 }]) expect(() => requireCoffeePage(approval, changed, 10)).toThrow();
    for (const now of [0, 100]) expect(() => requireCoffeePage(approval, binding, now)).toThrow();
    expect(coffeeProbeApproval.safeParse({ ...approval, pages: [...approval.pages.slice(1), approval.pages[1]] }).success).toBe(false);
  });
  it("다른 과정·다른 출처·사진 답안·일반 요청을 차단한다", () => {
    const state = tutorStateFixture(); const context = tutorContext(state); const before = JSON.stringify(context);
    expect(coffeeProbeUnit(approval, context, request, 10)).toBe(tutorId(5));
    expect(JSON.stringify(context)).toBe(before);
    expect(() => coffeeProbeUnit({ ...approval, courseId: tutorId(99) }, context, request, 10)).toThrow();
    expect(() => coffeeProbeUnit({ ...approval, pages: approval.pages.map(p => ({ ...p, filePage: 2 })) }, context, request, 10)).toThrow();
    expect(() => coffeeProbeUnit(approval, context, { ...request, messages: [{ role: "user", content: [{ type: "input_image", dataUrl: "data:image/png;base64,AAAA", detail: "low", width: 100, height: 100, bytes: 3, sourceRefId: tutorId(90) }] }] }, 10)).toThrow();
    expect(() => coffeeProbeUnit(approval, context, { ...request, responseContract: undefined }, 10)).toThrow();
    expect(coffeeProbeUnit(approval, { ...emptyLearningContext(), extractionPage: binding }, { ...request, responseContract: "page-vision" }, 10)).toBeNull();
  });
  it("실제 입력 1만 토큰·종류별 출력 상한·추론 없음만 허용한다", async () => {
    const pricing = fixturePricing(); const prepared = await prepareAiRequest(request);
    const bound = await calculateRequestBound(prepared, { requestFingerprint: prepared.requestFingerprint, model: "gpt-6-luna", inputTokens: 10000, providerRequestId: "fixture", checkedAt: pricing.pricing.provenance.checkedAt }, pricing, pricing.pricing.provenance.checkedAt);
    expect(() => requireCoffeeBound(request, bound)).not.toThrow();
    for (const changed of [{ ...bound, inputTokenBound: 10001 }, { ...bound, outputTokenBound: 1401 }]) expect(() => requireCoffeeBound(request, changed)).toThrow();
    expect(() => requireCoffeeBound({ ...request, reasoningEffort: "low" }, bound)).toThrow();
    expect(() => requireCoffeeBound({ ...request, responseContract: undefined }, bound)).toThrow();
  });
  it("30센트 승인·미확정 만원 예약·백업의 승인 이력을 유지한다", () => {
    const pricing = fixturePricing(); const base = fixturePrepaidProbe(fixtureFunding("owner", pricing.id, 1), pricing).funding;
    const coffeeProbe = { approvalId: approval.id, logicalRequestKey: "coffee-stage", requestFingerprint: "c".repeat(64), unitId: tutorId(5), kind: "tutor-lesson" as const };
    const funding = fundingSnapshot.parse({ ...base, prepaidProbe: { ...base.prepaidProbe, limitUsdMicros: 300000 }, coffeeProbe });
    expect(funding.prepaidProbe?.pendingPayment.reservedKrwUnits).toBe(10000000000);
    expect(fundingSnapshot.safeParse({ ...base, coffeeProbe }).success).toBe(false);
    const row = projectBackupRow("ai_funding_checks", { owner_id: "owner", reservation_id: tutorId(90), snapshot: JSON.stringify(funding), checked_at: 1 }, "owner");
    expect(JSON.parse(row.snapshot as string).coffeeProbe).toEqual(coffeeProbe);
    expect(() => validateBackupRow("ai_funding_checks", row, "owner")).not.toThrow();
    expect(JSON.stringify(row)).not.toMatch(/accountFingerprint|reconciledReservationIds/);
  });
  it("공통 실행 경로가 출처·지원·승인 만료를 검사하고 중복 호출 없이 비용 이력을 저장한다", async () => {
    const worker = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('coffee')}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
    try {
      const db = await worker.getD1Database("DB") as unknown as D1Database;
      const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
      for (const entry of journal.entries) for (const sql of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await db.prepare(sql).run();
      const owner = { realm: "sites" as const, userId: "coffee-runtime-fixture" }; const state = tutorStateFixture();
      const base = learningRuntimeFixture(db, owner, async () => tutorContext(state), async () => tutorLessonFixture());
      const now = Date.now(); const active = { ...approval, approvedAt: now - 1000, validUntil: now + 60000 };
      const probe = fixturePrepaidProbe(fixtureFunding(owner.userId, base.pricing.id, now), base.pricing);
      const funding = { ...probe.funding, prepaidProbe: { ...probe.funding.prepaidProbe!, limitUsdMicros: 300000 as const } };
      const runtime = { ...base.runtime, coffeeProbeApproval: active, checkFunding: (identity: typeof owner, bound: Parameters<typeof checkAiFunding>[2], time: number) => checkAiFunding(db, identity, bound, funding, time) };
      const input = { logicalRequestKey: "coffee-lesson-fixture", request, pricing: probe.pricing, expectedKind: "tutor-lesson" as const };
      await expect(runAiRequest({ ...runtime, authorizeSources: async (): Promise<void> => { throw new Error("모의 원본 거부"); } }, input, new AbortController().signal)).rejects.toThrow("모의 원본 거부");
      let clock = now;
      await expect(runAiRequest({ ...runtime, now: () => clock, requireSupport: async (): Promise<void> => { clock = active.validUntil; } }, input, new AbortController().signal)).rejects.toMatchObject({ operation: "coffee.approval-expired" });
      expect(base.generations()).toBe(0);
      expect((await runAiRequest(runtime, input, new AbortController().signal)).kind).toBe("validated");
      expect((await runAiRequest(runtime, input, new AbortController().signal)).kind).toBe("existing");
      expect(base.generations()).toBe(1);
      const saved = await db.prepare("SELECT snapshot FROM ai_funding_checks WHERE owner_id=?").bind(owner.userId).first<string>("snapshot");
      expect(JSON.parse(saved!).coffeeProbe.logicalRequestKey).toBe(input.logicalRequestKey);
      expect(JSON.parse(saved!).prepaidProbe.limitUsdMicros).toBe(300000);
    } finally { await worker.dispose(); }
  }, 20000);

});

it("품질 재검증을 포함한 31단계와 유형별 한도·동시 예약을 D1에서 검사한다", async () => {
  const worker = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('cap')}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
  try {
    const db = await worker.getD1Database("DB") as unknown as D1Database;
    await db.prepare("CREATE TABLE ai_funding_checks(owner_id TEXT,snapshot TEXT)").run();
    await db.prepare("CREATE TABLE atomic_checks(owner_id TEXT,id TEXT,request_id TEXT,step INTEGER,matched INTEGER CHECK(matched=1))").run();
    const owner = { realm: "sites" as const,userId: "cap" }; const now = 500;
    const pricing = fixturePricing(); const base = fixturePrepaidProbe(fixtureFunding(owner.userId,pricing.id,now),pricing);
    const prepared = await prepareAiRequest(request);
    const bound = await calculateRequestBound(prepared,{ requestFingerprint: prepared.requestFingerprint,model:"gpt-6-luna",inputTokens:1000,providerRequestId:"fixture",checkedAt:now },base.pricing,now);
    const reservationUsdMicros = usdReservationMicros(bound.amount);
    const snapshot = fundingSnapshot.parse({ ...base.funding,prepaidProbe: { ...base.funding.prepaidProbe,limitUsdMicros:300000 },reservationUsdMicros,coffeeProbe: { approvalId:approval.id,logicalRequestKey:"new-vision",requestFingerprint:bound.requestFingerprint,unitId:null,kind:"page-vision" } });
    for (let i=0;i<30;i+=1) await db.prepare("INSERT INTO ai_funding_checks VALUES (?,?)").bind(owner.userId,JSON.stringify({ ...snapshot,reservationUsdMicros:1,coffeeProbe:{ ...snapshot.coffeeProbe,logicalRequestKey:`saved-${i}`,kind:i<9?"page-vision":"tutor-lesson",unitId:i<9?null:tutorId(5) } })).run();
    const check = (): Promise<D1Result[]> => db.batch([...probeReservationChecks(db,owner,snapshot,bound,crypto.randomUUID())]);
    await expect(check()).resolves.toHaveLength(2);
    await expect(db.batch([...probeReservationChecks(db,owner,{ ...snapshot,coffeeProbe:{ ...snapshot.coffeeProbe!,kind:"tutor-lesson",unitId:tutorId(5) } },bound,crypto.randomUUID())])).rejects.toThrow();
    await db.prepare("INSERT INTO ai_funding_checks VALUES (?,?)").bind(owner.userId,JSON.stringify(snapshot)).run();
    await expect(check()).resolves.toHaveLength(2);
    await expect(db.batch([...probeReservationChecks(db,owner,{ ...snapshot,coffeeProbe:{ ...snapshot.coffeeProbe!,logicalRequestKey:"eleventh-vision" } },bound,crypto.randomUUID())])).rejects.toThrow();
    for(let i=0;i<2;i+=1) await db.prepare("INSERT INTO ai_funding_checks VALUES (?,?)").bind(owner.userId,JSON.stringify(snapshot)).run();
    await expect(check()).rejects.toThrow();
    expect(() => probeReservationChecks(db,owner,{ ...snapshot,prepaidProbe:{ ...snapshot.prepaidProbe!,limitUsdMicros:80000 } },bound,crypto.randomUUID())).toThrow();
  } finally { await worker.dispose(); }
},20000);
