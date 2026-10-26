import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import { aiConfiguration, scheduledReviewProbeApproval } from "../../lib/ai/configuration";
import type { ScheduledReviewProbeApproval } from "../../lib/ai/configuration";
import { prepareAiRequest } from "../../lib/ai/request-bound";
import type { ModelRequest } from "../../lib/ai/request-bound";
import { recordId } from "../../lib/domain/contracts";
import type { SiteIdentity } from "../../lib/domain/contracts";
import { ADVISOR_ACCEPTANCE_ID } from "../../lib/advisor/acceptance";
import { LIBRARIAN_HELP_ACCEPTANCE_ID, STUDY_ACCEPTANCE_TEXT } from "../../lib/librarian/acceptance-fixture";
import { initialTutor, beginTutorDiagnosis, saveTutorAnswer } from "../../lib/tutor/state";
import type { TutorState } from "../../lib/tutor/contracts";
import { tutorRequest, tutorContext } from "../../lib/tutor/ai";
import { makeReviewTask, reviewBinding } from "../../lib/reviews/contracts";
import { prepareScheduledReviewApproval, requireScheduledReviewProbe, scheduledReviewProbeDispatcher } from "../../lib/reviews/scheduled-acceptance";
import { tutorStartFixture, tutorId } from "../fixtures/tutor-state";
import { learningRuntimeFixture } from "../fixtures/learning-ai-runtime";
import { fixtureFunding, fixturePrepaidProbe } from "../fixtures/ai-funding";
import { fixturePricing } from "../fixtures/ai-pricing";
import { checkAiFunding } from "../../db/repositories/ai-funding";

type Fixture = Readonly<{ state: TutorState; request: ModelRequest; approval: ScheduledReviewProbeApproval; now: number }>;
/** 통제된 시각은 검사 입력일 뿐이며 실제 날짜 경과나 휴대폰 수행을 증명하지 않습니다. */
async function fixture(today: "2026-10-26" | "2026-10-28"): Promise<Fixture> {
  const now: number = Date.parse(`${today}T00:10:00+09:00`);
  const start = tutorStartFixture();
  const initial = initialTutor(tutorId(1801), { ...start, today, scopeId: recordId.parse(LIBRARIAN_HELP_ACCEPTANCE_ID), bundle: { ...start.bundle, unit: { ...start.bundle.unit, planId: recordId.parse(ADVISOR_ACCEPTANCE_ID) }, sources: [{ ...start.bundle.sources[0], evidence: STUDY_ACCEPTANCE_TEXT }] } }, tutorId(1802), tutorId(1803));
  const task = makeReviewTask("concept", initial.start.bundle.unit.selfExplanationCriterion, tutorId(1804), "다섯 조각 중 두 조각을 분수로 나타내세요.", [initial.start.bundle.sources[0].id]);
  const review = reviewBinding.parse({ reviewId: tutorId(1805), reviewVersion: 2, planVersion: 3, scheduleId: tutorId(1806), proposalId: tutorId(1806), basisResultVersionId: tutorId(1807), baselineAt: Date.parse("2026-10-25T01:00:00Z"), dueDate: today, kind: "delayed-recall", task, correctionId: null });
  const question = { ...initial.question, prompt: task.prompt };
  const ready: TutorState = { ...initial, review, phase: "awaiting-answer", question, questions: [question] };
  const state: TutorState = beginTutorDiagnosis(saveTutorAnswer(ready, { id: tutorId(1808), questionId: question.id, attemptId: question.attemptId, text: "새 예시: 같은 크기의 아홉 조각에서 네 조각을 선택했습니다.\n자신의 설명: 4/9이며 분모는 전체 조각 수, 분자는 선택한 조각 수입니다.", fileIds: [], submittedAt: now - 5000, helped: false }));
  const request: ModelRequest = tutorRequest(state, []);
  const approval: ScheduledReviewProbeApproval = { sessionId: state.id, reviewId: review.reviewId, scheduleId: review.scheduleId, basisResultVersionId: review.basisResultVersionId, dueDate: review.dueDate, notBeforeDate: today, requestFingerprint: (await prepareAiRequest(request)).requestFingerprint, approvedAt: now - 1000, validUntil: now + 60000 };
  return { state, request, approval, now };
}

describe("예정일 이후 직접 작성한 복습 답안의 제한된 승인", (): void => {
  it("저장된 답안·일정·요청이 일치하면 허용하며 입력을 바꾸지 않는다", async (): Promise<void> => {
    const f = await fixture("2026-10-28"); const before: string = JSON.stringify(f);
    expect((await requireScheduledReviewProbe(f.state, f.approval, f.request, f.now)).imageCount).toBe(0);
    expect(JSON.stringify(f)).toBe(before);
  });
  it("사용자가 26일로 앞당긴 실제 일정도 저장 답안 이후 승인으로 허용한다", async (): Promise<void> => {
    const f: Fixture = await fixture("2026-10-26");
    await expect(requireScheduledReviewProbe(f.state, f.approval, f.request, f.now)).resolves.toBeDefined();
    await expect(requireScheduledReviewProbe(f.state, { ...f.approval, notBeforeDate: "2026-10-28" }, f.request, f.now)).rejects.toThrow();
    await expect(requireScheduledReviewProbe({ ...f.state, review: { ...f.state.review!, baselineAt: f.now - 10000 } }, f.approval, f.request, f.now)).rejects.toThrow();
  });
  it("서울 자정 이전은 거부하고 예정일의 새 답안만 허용한다", async (): Promise<void> => {
    const f = await fixture("2026-10-28"); const midnight: number = Date.parse("2026-10-27T15:00:00Z");
    const at: TutorState = { ...f.state, answers: f.state.answers.map((answer) => ({ ...answer, submittedAt: midnight })) };
    const request = tutorRequest(at, []); const approved = { ...f.approval, approvedAt: midnight, requestFingerprint: (await prepareAiRequest(request)).requestFingerprint };
    await expect(requireScheduledReviewProbe(at, approved, request, midnight)).resolves.toBeDefined();
    const early: TutorState = { ...at, start: { ...at.start, today: "2026-10-27" }, answers: at.answers.map((answer) => ({ ...answer, submittedAt: midnight - 2 })) };
    const earlyRequest = tutorRequest(early, []);
    await expect(requireScheduledReviewProbe(early, { ...approved, approvedAt: midnight - 2, requestFingerprint: (await prepareAiRequest(earlyRequest)).requestFingerprint }, earlyRequest, midnight - 1)).rejects.toMatchObject({ operation: "review.probe-actual-seoul-date-required" });
  });
  it("예정일 전에 쓴 답안·미래 제출·같은 기준 날짜를 거부한다", async (): Promise<void> => {
    const f = await fixture("2026-10-28");
    for (const submittedAt of [Date.parse("2026-10-27T14:59:59Z"), f.now + 1]) await expect(requireScheduledReviewProbe({ ...f.state, answers: f.state.answers.map((answer) => ({ ...answer, submittedAt })) }, f.approval, f.request, f.now)).rejects.toThrow();
    await expect(requireScheduledReviewProbe({ ...f.state, review: { ...f.state.review!, baselineAt: f.now - 10000 } }, f.approval, f.request, f.now)).rejects.toThrow();
    await expect(requireScheduledReviewProbe({ ...f.state, start: { ...f.state.start, today: "2026-10-27" } }, f.approval, f.request, f.now)).rejects.toThrow();
  });
  it("미래 승인·만료 승인·답안 저장 전 승인을 거부한다", async (): Promise<void> => {
    const f = await fixture("2026-10-28");
    for (const approval of [{ ...f.approval, approvedAt: f.now + 1 }, { ...f.approval, validUntil: f.now }, { ...f.approval, approvedAt: f.state.answers[0].submittedAt - 1 }]) await expect(requireScheduledReviewProbe(f.state, approval, f.request, f.now)).rejects.toThrow();
  });
  it("회차·일정·기준 확정본·기한의 불일치를 거부한다", async (): Promise<void> => {
    const f = await fixture("2026-10-28");
    for (const approval of [{ ...f.approval, sessionId: tutorId(1999) }, { ...f.approval, reviewId: tutorId(1999) }, { ...f.approval, scheduleId: tutorId(1999) }, { ...f.approval, basisResultVersionId: tutorId(1999) }, { ...f.approval, dueDate: "2026-10-29" }]) await expect(requireScheduledReviewProbe(f.state, approval, f.request, f.now)).rejects.toThrow();
  });
  it("사적 자료·사진·도움 받은 답안·다른 생성 단계를 거부한다", async (): Promise<void> => {
    const f = await fixture("2026-10-28"); const answer = f.state.answers[0];
    const cases: readonly TutorState[] = [
      { ...f.state, start: { ...f.state.start, bundle: { ...f.state.start.bundle, sources: [{ ...f.state.start.bundle.sources[0], evidence: "개인 자료" }] } } },
      { ...f.state, answers: [{ ...answer, fileIds: [tutorId(1999)] }] },
      { ...f.state, answers: [{ ...answer, helped: true }] },
      { ...f.state, answers: [{ ...answer, text: "" }] },
      { ...f.state, pending: { kind: "tutor-scaffold", key: "help" } },
    ];
    for (const state of cases) await expect(requireScheduledReviewProbe(state, f.approval, f.request, f.now)).rejects.toThrow();
  });
  it("답안·프롬프트·출력 상한 변경은 같은 승인으로 전송하지 않는다", async (): Promise<void> => {
    const f = await fixture("2026-10-28");
    for (const request of [{ ...f.request, instructions: "다른 지시" }, { ...f.request, maximumOutputTokens: 1401 }]) await expect(requireScheduledReviewProbe(f.state, { ...f.approval, requestFingerprint: (await prepareAiRequest(request)).requestFingerprint }, request, f.now)).rejects.toThrow();
    const state = { ...f.state, answers: f.state.answers.map((answer) => ({ ...answer, text: "수정한 답안" })) };
    await expect(requireScheduledReviewProbe(state, f.approval, tutorRequest(state, []), f.now)).rejects.toThrow();
  });
  it("수정 답안의 새 승인도 이전 답안·시도 기록을 지우지 않는다", async (): Promise<void> => {
    const f = await fixture("2026-10-28"); const previous = f.state.answers[0]; const answer = { ...previous, id: tutorId(1810), attemptId: tutorId(1811), text: "새 예시: 같은 크기 열 조각 중 셋입니다.\n자신의 설명: 3/10입니다." };
    const state: TutorState = { ...f.state, currentAnswerId: answer.id, question: { ...f.state.question, attemptId: answer.attemptId }, answers: [previous, answer] };
    const request = tutorRequest(state, []); const approval = { ...f.approval, requestFingerprint: (await prepareAiRequest(request)).requestFingerprint };
    await expect(requireScheduledReviewProbe(state, approval, request, f.now)).resolves.toBeDefined();
    expect(state.answers).toEqual([previous, answer]);
  });
  it("시험 가격만 허용하고 이른 날짜·겹치는 회차 승인을 거부한다", async (): Promise<void> => {
    const f = await fixture("2026-10-28"); const pricing = fixturePricing(); const funding = fixtureFunding("owner", pricing.id, f.now);
    expect(aiConfiguration.safeParse({ pricing, funding, support: [], scheduledReviewProbeApproval: f.approval }).success).toBe(false);
    const probe = fixturePrepaidProbe(funding, pricing);
    expect(aiConfiguration.safeParse({ ...probe, support: [], scheduledReviewProbeApproval: f.approval }).success).toBe(true);
    expect(scheduledReviewProbeApproval.safeParse({ ...f.approval, dueDate: "2026-10-27" }).success).toBe(false);
    expect(scheduledReviewProbeApproval.safeParse({ ...f.approval, notBeforeDate: "2026-10-25" }).success).toBe(false);
    expect(aiConfiguration.safeParse({ ...probe, support: [], scheduledReviewProbeApproval: f.approval, handwritingProbeApproval: { sessionId: f.state.id, materialId: tutorId(1999), imageSha256: "a".repeat(64), requestFingerprint: "b".repeat(64), approvedAt: 1, validUntil: 2 } }).success).toBe(false);
  });
  it("저장 상태에서 후보를 계산해도 원본을 바꾸거나 교재·답안을 반환하지 않는다", async (): Promise<void> => {
    const f = await fixture("2026-10-26");
    const saved: TutorState = { ...f.state, phase: "answer-saved", version: f.state.version - 1, pending: null };
    const before: string = JSON.stringify(saved);
    const candidate = await prepareScheduledReviewApproval(saved, f.now, f.now + 60000);
    expect(candidate.requestFingerprint).toBe(f.approval.requestFingerprint);
    expect(JSON.stringify(saved)).toBe(before);
    expect(Object.keys(candidate).sort()).toEqual(Object.keys(f.approval).sort());
    await expect(requireScheduledReviewProbe(beginTutorDiagnosis(saved), candidate, f.request, f.now)).resolves.toBeDefined();
  });
  it("후보 생성도 미제출·사적 자료·미래 일정·만료 기한을 거부한다", async (): Promise<void> => {
    const f = await fixture("2026-10-26");
    const saved: TutorState = { ...f.state, phase: "answer-saved", version: f.state.version - 1, pending: null };
    await expect(prepareScheduledReviewApproval(f.state, f.now, f.now + 60000)).rejects.toThrow();
    await expect(prepareScheduledReviewApproval({ ...saved, start: { ...saved.start, bundle: { ...saved.start.bundle, sources: [{ ...saved.start.bundle.sources[0], evidence: "개인 자료" }] } } }, f.now, f.now + 60000)).rejects.toThrow();
    await expect(prepareScheduledReviewApproval({ ...saved, review: { ...saved.review!, dueDate: "2026-10-28" } }, f.now, f.now + 60000)).rejects.toThrow();
    await expect(prepareScheduledReviewApproval(saved, f.now, f.now)).rejects.toThrow();
  });
  it("실제 로컬 D1에서 승인 만료·원본 거부·중복 생성·누적 한도를 검사한다", async (): Promise<void> => {
    const worker: Miniflare = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('review-probe-check')}}", compatibilityDate: "2026-05-15", d1Databases: ["DB"], d1Persist: false, cf: false });
    try {
      const db: D1Database = await worker.getD1Database("DB") as unknown as D1Database;
      const journal: Readonly<{ entries: readonly Readonly<{ tag: string }>[] }> = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
      for (const entry of journal.entries) for (const sql of (await readFile(`drizzle/${entry.tag}.sql`, "utf8")).split("--> statement-breakpoint").map((value: string): string => value.trim()).filter(Boolean)) await db.prepare(sql).run();
      const f = await fixture("2026-10-28"); const owner: SiteIdentity = { realm: "sites", userId: "review-probe-fixture-owner" };
      const base = learningRuntimeFixture(db, owner, async () => tutorContext(f.state), async () => ({ kind: "tutor-diagnosis", questionId: f.state.question.id, answerId: f.state.answers[0].id, readability: "readable", correct: false, needsHelp: true, observation: "합성 응답이며 실제 복습 수행 증거가 아닙니다.", citations: [{ sourceRefId: f.state.start.bundle.sources[0].id, quote: "분수는 전체를 같은 크기로 나눈 부분을 나타냅니다." }] }));
      const provenance = { ...base.pricing.pricing.provenance, checkedAt: f.now - 1000, validFrom: f.now - 1000, validUntil: f.now + 3600000 };
      const pricing = { ...base.pricing, pricing: { ...base.pricing.pricing, provenance }, exchange: { ...base.pricing.exchange, provenance }, tax: { ...base.pricing.tax, provenance }, fee: { ...base.pricing.fee, provenance } };
      const probe = fixturePrepaidProbe(fixtureFunding(owner.userId, pricing.id, f.now), pricing);
      const funding = { ...probe.funding, prepaidProbe: { ...probe.funding.prepaidProbe!, limitUsdMicros: 80000 as const } };
      const runtime = { ...base.runtime, now: (): number => f.now, fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init); if (request.url.endsWith("/input_tokens")) return Response.json({ input_tokens: 160000 }, { headers: { "x-request-id": "req_review_probe_count_fixture" } });
        return base.runtime.fetch(input, init);
      }, checkFunding: (current: SiteIdentity, bound: Parameters<typeof checkAiFunding>[2], now: number) => checkAiFunding(db, current, bound, funding, now) };
      const dispatch = scheduledReviewProbeDispatcher(f.state, f.approval);
      const input = { logicalRequestKey: f.state.pending!.key, request: f.request, pricing: probe.pricing, expectedKind: "tutor-diagnosis" as const };
      await expect(dispatch({ ...runtime, authorizeSources: async (): Promise<void> => { throw new Error("모의 원본 거부"); } }, input, new AbortController().signal)).rejects.toThrow("모의 원본 거부");
      let clock: number = f.now;
      await expect(dispatch({ ...runtime, now: (): number => clock, requireSupport: async (): Promise<void> => { clock = f.approval.validUntil; } }, input, new AbortController().signal)).rejects.toMatchObject({ operation: "review.probe-actual-seoul-date-required" });
      expect(base.generations()).toBe(0);
      expect((await dispatch(runtime, input, new AbortController().signal)).kind).toBe("validated");
      expect((await dispatch(runtime, input, new AbortController().signal)).kind).toBe("existing");
      const second: TutorState = { ...f.state, pending: { kind: "tutor-diagnosis", key: "review-second-logical-request" } };
      await expect(scheduledReviewProbeDispatcher(second, f.approval)(runtime, { ...input, logicalRequestKey: second.pending!.key }, new AbortController().signal)).rejects.toThrow();
      expect(base.generations()).toBe(1); expect(await db.prepare("SELECT COUNT(*) AS n FROM ai_calls").first<number>("n")).toBe(1);
    } finally { await worker.dispose(); }
  }, 20000);
});
