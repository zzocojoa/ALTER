import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { aiConfiguration } from "../../lib/ai/configuration";
import type { HandwritingProbeApproval } from "../../lib/ai/configuration";
import { prepareAiRequest } from "../../lib/ai/request-bound";
import type { ModelRequest, InputImage } from "../../lib/ai/request-bound";
import { hashFile } from "../../lib/learning-upload";
import { ADVISOR_ACCEPTANCE_ID } from "../../lib/advisor/acceptance";
import { LIBRARIAN_HELP_ACCEPTANCE_ID, STUDY_ACCEPTANCE_TEXT } from "../../lib/librarian/acceptance-fixture";
import { initialTutor, beginDirectTutorAnswer, saveTutorAnswer, beginTutorDiagnosis } from "../../lib/tutor/state";
import { tutorRequest, tutorContext, dispatchTutor } from "../../lib/tutor/ai";
import type { TutorState } from "../../lib/tutor/contracts";
import { approvedTutorDispatcher, requireHandwritingProbe } from "../../lib/tutor/handwriting-acceptance";
import { tutorStartFixture, tutorId } from "../fixtures/tutor-state";
import { learningRuntimeFixture } from "../fixtures/learning-ai-runtime";
import { fixtureFunding, fixturePrepaidProbe } from "../fixtures/ai-funding";
import { fixturePricing } from "../fixtures/ai-pricing";
import { checkAiFunding } from "../../db/repositories/ai-funding";
import { recordId } from "../../lib/domain/contracts";
import type { SiteIdentity } from "../../lib/domain/contracts";

type Fixture = Readonly<{ state: TutorState; image: InputImage; request: ModelRequest; approval: HandwritingProbeApproval; now: number }>;
async function fixture(): Promise<Fixture> {
  const start = tutorStartFixture();
  const initial = initialTutor(tutorId(939), { ...start, scopeId: recordId.parse(LIBRARIAN_HELP_ACCEPTANCE_ID), bundle: { ...start.bundle, unit: { ...start.bundle.unit, planId: recordId.parse(ADVISOR_ACCEPTANCE_ID) }, sources: [{ ...start.bundle.sources[0], evidence: STUDY_ACCEPTANCE_TEXT }] } }, tutorId(940), tutorId(941));
  const image: InputImage = { type: "input_image", sourceRefId: tutorId(942), dataUrl: "data:image/png;base64,AAEC", bytes: 3, width: 1, height: 1, detail: "high" };
  const state: TutorState = beginTutorDiagnosis(saveTutorAnswer(beginDirectTutorAnswer(initial), { id: tutorId(943), questionId: initial.question.id, attemptId: initial.question.attemptId, text: "", fileIds: [image.sourceRefId], submittedAt: 1, helped: false }));
  const request: ModelRequest = tutorRequest(state, [image]);
  const now: number = Date.now();
  const approval: HandwritingProbeApproval = { sessionId: state.id, materialId: image.sourceRefId, imageSha256: await hashFile(new Uint8Array([0, 1, 2]).buffer), requestFingerprint: (await prepareAiRequest(request)).requestFingerprint, approvedAt: now - 1000, validUntil: now + 60000 };
  return { state, image, request, approval, now };
}

describe("승인한 손글씨 시험 사진의 제한된 호출", (): void => {
  it("정확한 사진·요청을 허용하고 입력을 변경하지 않는다", async (): Promise<void> => {
    const f = await fixture(); const before: string = JSON.stringify(f);
    expect((await requireHandwritingProbe(f.state, f.approval, f.request, f.now)).imageCount).toBe(1);
    expect(JSON.stringify(f)).toBe(before);
  });
  it("승인 없거나 다른 회차이면 일반 호출의 가격 검증을 유지한다", async (): Promise<void> => {
    const f = await fixture();
    expect(approvedTutorDispatcher(f.state, undefined)).toBe(dispatchTutor);
    expect(approvedTutorDispatcher(f.state, { ...f.approval, sessionId: tutorId(999) })).toBe(dispatchTutor);
  });
  it("승인 이전·만료 시점과 다른 회차를 거부한다", async (): Promise<void> => {
    const f = await fixture();
    for (const now of [f.approval.approvedAt - 1, f.approval.validUntil]) await expect(requireHandwritingProbe(f.state, f.approval, f.request, now)).rejects.toThrow();
    await expect(requireHandwritingProbe({ ...f.state, id: tutorId(999) }, f.approval, f.request, f.now)).rejects.toThrow();
  });
  it("텍스트 답안으로 사진 판독을 대체하거나 사진을 추가하면 거부한다", async (): Promise<void> => {
    const f = await fixture(); const answer = f.state.answers[0];
    for (const value of [{ ...answer, text: "1/4입니다." }, { ...answer, fileIds: [f.approval.materialId, tutorId(999)] }, { ...answer, fileIds: [tutorId(999)] }]) await expect(requireHandwritingProbe({ ...f.state, answers: [value] }, f.approval, f.request, f.now)).rejects.toThrow();
  });
  it("같은 사진의 재제출은 새 요청 승인 후 허용하고 이력을 보존한다", async (): Promise<void> => {
    const f = await fixture(); const previous = f.state.answers[0];
    const answer = { ...previous, id: tutorId(944), attemptId: tutorId(945) };
    const state: TutorState = { ...f.state, currentAnswerId: answer.id, question: { ...f.state.question, attemptId: answer.attemptId }, answers: [previous, answer], pending: { kind: "tutor-diagnosis", key: "handwriting-revised" } };
    const request: ModelRequest = tutorRequest(state, [f.image]);
    await expect(requireHandwritingProbe(state, f.approval, request, f.now)).rejects.toThrow();
    const approval: HandwritingProbeApproval = { ...f.approval, requestFingerprint: (await prepareAiRequest(request)).requestFingerprint };
    expect((await requireHandwritingProbe(state, approval, request, f.now)).imageCount).toBe(1);
    expect(state.answers).toEqual([previous, answer]);
  });
  it("다른 교재·계획·범위를 거부한다", async (): Promise<void> => {
    const f = await fixture(); const start = f.state.start;
    for (const value of [{ ...start, scopeId: tutorId(999) }, { ...start, bundle: { ...start.bundle, unit: { ...start.bundle.unit, planId: tutorId(999) } } }, { ...start, bundle: { ...start.bundle, sources: [{ ...start.bundle.sources[0], evidence: "개인 교재" }] } }]) await expect(requireHandwritingProbe({ ...f.state, start: value }, f.approval, f.request, f.now)).rejects.toThrow();
  });
  it("사진 바이트·전체 요청·원본 해시의 변경을 거부한다", async (): Promise<void> => {
    const f = await fixture();
    const altered: ModelRequest = tutorRequest(f.state, [{ ...f.image, dataUrl: "data:image/png;base64,AAED" }]);
    await expect(requireHandwritingProbe(f.state, f.approval, altered, f.now)).rejects.toThrow();
    await expect(requireHandwritingProbe(f.state, f.approval, { ...f.request, maximumOutputTokens: 1401 }, f.now)).rejects.toThrow();
    await expect(requireHandwritingProbe(f.state, { ...f.approval, imageSha256: "0".repeat(64) }, f.request, f.now)).rejects.toThrow();
    const modified: ModelRequest = { ...f.request, instructions: "다른 지시" };
    await expect(requireHandwritingProbe(f.state, { ...f.approval, requestFingerprint: (await prepareAiRequest(modified)).requestFingerprint }, modified, f.now)).rejects.toThrow();
  });
  it("다른 생성 단계·이미지 없는 요청·여러 이미지를 거부한다", async (): Promise<void> => {
    const f = await fixture();
    await expect(requireHandwritingProbe({ ...f.state, pending: { key: "help", kind: "tutor-scaffold" } }, f.approval, f.request, f.now)).rejects.toThrow();
    for (const images of [[], [f.image, f.image]]) {
      const request: ModelRequest = tutorRequest(f.state, images);
      await expect(requireHandwritingProbe(f.state, { ...f.approval, requestFingerprint: (await prepareAiRequest(request)).requestFingerprint }, request, f.now)).rejects.toThrow();
    }
  });
  it("미확정 결제 시험 설정에서만 승인 형식을 허용한다", async (): Promise<void> => {
    const f = await fixture(); const pricing = fixturePricing(); const funding = fixtureFunding("owner", pricing.id, f.now);
    expect(aiConfiguration.safeParse({ pricing, funding, support: [], handwritingProbeApproval: f.approval }).success).toBe(false);
    const probe = fixturePrepaidProbe(funding, pricing);
    expect(aiConfiguration.safeParse({ ...probe, support: [], handwritingProbeApproval: f.approval }).success).toBe(true);
    expect(aiConfiguration.safeParse({ ...probe, support: [], handwritingProbeApproval: { ...f.approval, imageSha256: "unknown" } }).success).toBe(false);
  });
  it("실제 로컬 D1 비용 경로에서 저장·중복 복구·누적 상한을 유지한다", async (): Promise<void> => {
    const worker: Miniflare = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('handwriting-check')}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
    try {
      const db: D1Database = await worker.getD1Database("DB") as unknown as D1Database;
      const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
      for (const entry of journal.entries) for (const sql of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((value: string): string => value.trim()).filter(Boolean)) await db.prepare(sql).run();
      const f = await fixture(); const owner: SiteIdentity = { realm: "sites", userId: "handwriting-fixture-owner" };
      const base = learningRuntimeFixture(db, owner, async () => tutorContext(f.state), async () => ({ kind: "tutor-diagnosis", questionId: f.state.question.id, answerId: f.state.answers[0].id, readability: "readable", correct: true, needsHelp: false, observation: "합성 응답이며 실제 손글씨 판독 증거가 아닙니다.", citations: [{ sourceRefId: f.state.start.bundle.sources[0].id, quote: "분수는 전체를 같은 크기로 나눈 부분을 나타냅니다." }] }));
      const probe = fixturePrepaidProbe(fixtureFunding(owner.userId, base.pricing.id, f.now), base.pricing);
      const funding = { ...probe.funding, prepaidProbe: { ...probe.funding.prepaidProbe!, limitUsdMicros: 80000 as const } };
      const runtime = { ...base.runtime, fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init);
        if (request.url.endsWith("/input_tokens")) return Response.json({ input_tokens: 160000 }, { headers: { "x-request-id": "req_handwriting_count_fixture" } });
        return base.runtime.fetch(input, init);
      }, checkFunding: (current: SiteIdentity, bound: Parameters<typeof checkAiFunding>[2], now: number) => checkAiFunding(db, current, bound, funding, now) };
      const dispatch = approvedTutorDispatcher(f.state, f.approval);
      const input = { logicalRequestKey: f.state.pending!.key, request: f.request, pricing: probe.pricing, expectedKind: "tutor-diagnosis" as const };
      expect((await dispatch(runtime, input, new AbortController().signal)).kind).toBe("validated");
      expect((await dispatch(runtime, input, new AbortController().signal)).kind).toBe("existing");
      expect(base.generations()).toBe(1);
      const second: TutorState = { ...f.state, pending: { kind: "tutor-diagnosis", key: "handwriting-second-logical-request" } };
      await expect(approvedTutorDispatcher(second, f.approval)(runtime, { ...input, logicalRequestKey: second.pending!.key }, new AbortController().signal)).rejects.toThrow();
      expect(base.generations()).toBe(1);
      expect(await db.prepare("SELECT COUNT(*) AS n FROM ai_calls").first<number>("n")).toBe(1);
    } finally { await worker.dispose(); }
  }, 20000);
});
