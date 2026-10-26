import { ZodError } from "zod";
import { runLibrarianFixture } from "./librarian-worker";
import { librarianOutputFixture } from "./librarian-output";
import { learningRuntimeFixture } from "./learning-ai-runtime";
import { tutorOutputFixture } from "./tutor-output";
import { roommateFixture } from "./weekly-roommate";
import { recordId, seoulStudyDate } from "../../lib/domain/contracts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts";
import type { ConfirmedUnit, ScopeInput } from "../../lib/librarian/contracts";
import type { TutorState } from "../../lib/tutor/contracts";
import type { WeeklyProposal } from "../../lib/weekly/planning";
import { weeklyAdjustmentRules } from "../../lib/weekly/adjustments";
import { allocateWeeklyProposal } from "../../lib/weekly/planning";
import { weeklyBusinessKey } from "../../lib/weekly/confirmation";
import { supportedWeeklyClaims } from "../../lib/weekly/claims";
import { createTutor, getTutor } from "../../db/repositories/tutor";
import { dispatchTutorAction, submitStoredTutorAnswer } from "../../db/repositories/tutor-actions";
import { beginStoredTutorAi, processTutorAi, tutorContext, tutorRequest, dispatchTutor } from "../../lib/tutor/ai";
import { readResultSnapshot } from "../../db/repositories/result-draft";
import { confirmSessionResult } from "../../db/repositories/result-confirmation";
import { createMaterialLink, listConfirmedUnits } from "../../db/repositories/librarian-links";
import { createStudyScope, getStudyScope, beginStoredScopeEvaluation, saveScopeEvaluation, confirmStoredScope } from "../../db/repositories/study-scopes";
import { createWeeklyWorkspace, readWeeklyWorkspace, saveWeeklyWorkspace, setWeeklyTime } from "../../db/repositories/weekly-workspace";
import { confirmWeeklyWorkspace, readWeeklyFrozen } from "../../db/repositories/weekly-confirmation";
import { exportWeeklySummary } from "../../db/repositories/weekly";
import { isDomainFailure } from "../../db/repositories/atomic";

type Fixture = Readonly<{ db: D1Database; bucket: R2Bucket; owner: SiteIdentity }>;
function check(value: boolean, message: string): void { if (!value) throw new Error(message); }
function id(): ReturnType<typeof recordId.parse> { return recordId.parse(crypto.randomUUID()); }
function command(owner: SiteIdentity, expectedVersion: number): Command { return { owner, expectedVersion, requestKey: crypto.randomUUID() }; }
async function denied(action: () => Promise<unknown>, operation: string): Promise<void> {
  try { await action(); } catch (error: unknown) {
    if (isDomainFailure(error) && error.operation === operation) return;
    if (operation === "schema" && error instanceof ZodError) return;
    throw error;
  }
  throw new Error(`거부 누락: ${operation}`);
}
async function generate(fixture: Fixture, sessionId: string, action: "diagnose" | "variation"): Promise<TutorState> {
  const { db, bucket, owner } = fixture;
  const current = await getTutor(db, owner, sessionId);
  await beginStoredTutorAi(db, bucket, command(owner, current.version), sessionId, action);
  const pending = await getTutor(db, owner, sessionId);
  const ai = learningRuntimeFixture(db, owner, async () => tutorContext(await getTutor(db, owner, sessionId)), async () => tutorOutputFixture(await getTutor(db, owner, sessionId)));
  return processTutorAi(ai.runtime, bucket, owner, sessionId, ai.pricing, tutorRequest(pending, []), dispatchTutor, new AbortController().signal);
}
async function submit(fixture: Fixture, sessionId: string, text: string): Promise<void> {
  const current = await getTutor(fixture.db, fixture.owner, sessionId);
  await submitStoredTutorAnswer(fixture.db, fixture.bucket, command(fixture.owner, current.version), sessionId, id(), { text, fileIds: [] }, Date.now());
}
async function startLesson(fixture: Fixture, scopeId: string): Promise<string> {
  const sessionId: string = id();
  await createTutor(fixture.db, fixture.bucket, command(fixture.owner, 1), { id: sessionId, scopeId, questionId: id(), attemptId: id() }, Date.now());
  const state = await getTutor(fixture.db, fixture.owner, sessionId);
  await dispatchTutorAction(fixture.db, fixture.bucket, command(fixture.owner, state.version), { action: "direct", id: state.id, expectedVersion: state.version }, Date.now());
  return sessionId;
}
async function confirmLesson(fixture: Fixture, sessionId: string): Promise<void> {
  const current = await getTutor(fixture.db, fixture.owner, sessionId);
  const snapshot = await readResultSnapshot(fixture.db, fixture.owner, sessionId);
  check(snapshot.draft.canConfirm, "수업 결과 확정 근거 누락");
  await confirmSessionResult(fixture.db, command(fixture.owner, current.version), { id: current.id, expectedVersion: current.version, expectedSessionVersion: snapshot.sessionVersion, expectedOfficialVersion: snapshot.draft.officialVersion, fingerprint: snapshot.draft.fingerprint }, Date.now());
}
async function prepareScope(fixture: Fixture, unit: ConfirmedUnit, linkId: string): Promise<string> {
  const { db, bucket, owner } = fixture;
  const input: ScopeInput = { id: id(), planVersionId: unit.planVersionId, unitId: unit.unitId, date: seoulStudyDate(Date.now()), availableMinutes: 30, questionMinutes: 5, practiceMinutes: 10, linkIds: [recordId.parse(linkId)] };
  await createStudyScope(db, bucket, command(owner, 1), input);
  await beginStoredScopeEvaluation(db, bucket, command(owner, 1), input.id);
  const evaluating = await getStudyScope(db, owner, input.id);
  await saveScopeEvaluation(db, bucket, owner, evaluating, librarianOutputFixture(evaluating));
  const proposed = await getStudyScope(db, owner, input.id);
  check(proposed.selection?.status === "ready", JSON.stringify({ operation: "weekly-adjustment-scope", selection: proposed.selection }));
  await confirmStoredScope(db, bucket, command(owner, proposed.version), input.id, { reviewedVersion: proposed.version, reviewedSources: true, acceptedTime: true, acceptedAssessment: true });
  return input.id;
}
/** 모의 평가만 사용하고 답안·확정·선수 관계·주간 기록은 실제 D1/R2 저장 경로로 연결합니다. */
async function verify(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, scopeId: string): Promise<readonly string[]> {
  const fixture: Fixture = { db, bucket, owner };
  const base = await getStudyScope(db, owner, scopeId);
  const rootSession: string = await startLesson(fixture, scopeId);
  await submit(fixture, rootSession, "분수는 전체를 같은 크기로 나눈 부분 중 선택한 부분입니다.");
  await generate(fixture, rootSession, "diagnose");
  await generate(fixture, rootSession, "variation");
  await submit(fixture, rootSession, "같은 크기 다섯 조각 중 두 조각이므로 2/5입니다.");
  await generate(fixture, rootSession, "diagnose");
  await confirmLesson(fixture, rootSession);
  const unit = (await listConfirmedUnits(db, owner)).find(candidate => candidate.prerequisiteUnitIds.includes(base.unit.unitId));
  if (!unit) throw new Error("확정된 선수 단원 관계 누락");
  const link = base.candidates[0].link;
  const linkId = id();
  await createMaterialLink(db, bucket, command(owner, 1), { id: linkId, planVersionId: unit.planVersionId, unitId: unit.unitId, materialId: link.materialId, toc: unit.title, sourceRefIds: link.sourceRefIds, bibliography: link.bibliography, readingMinutes: link.readingMinutes });
  const wrongAnswerIds: string[] = [];
  for (const text of ["분모가 같은 덧셈에서 분모도 더하는지 모르겠습니다.", "같은 분모를 유지해야 하는 이유를 아직 모르겠습니다."]) {
    const freshScope: string = await prepareScope(fixture, unit, linkId);
    const sessionId: string = await startLesson(fixture, freshScope);
    await submit(fixture, sessionId, text);
    const diagnosed = await generate(fixture, sessionId, "diagnose");
    if (!diagnosed.currentAnswerId) throw new Error("오답 ID 누락");
    wrongAnswerIds.push(diagnosed.currentAnswerId);
    await confirmLesson(fixture, sessionId);
  }
  const weeklyId = id();
  await createWeeklyWorkspace(db, bucket, command(owner, 1), { id: weeklyId, courseId: unit.courseId, date: seoulStudyDate(Date.now()), availableMinutes: 30 });
  const initial = await readWeeklyWorkspace(db, owner, weeklyId);
  const catalog = supportedWeeklyClaims(initial.context.aggregate, initial.context.sources.map(source => source.id));
  const errors = catalog.filter(claim => claim.kind === "incorrect-answer" && wrongAnswerIds.includes(claim.answerId));
  check(errors.length === 2 && new Set(errors.map(claim => claim.answerId)).size === 2, "서로 다른 확정 오답 두 개의 주간 근거 누락");
  const rule = weeklyAdjustmentRules(initial.context).find(item => item.unitId === unit.unitId && item.action === "return-to-prerequisite");
  check(rule?.targetUnitId === base.unit.unitId && errors.every(claim => rule.claimIds.includes(claim.id)), "실제 저장된 반복 오답에서 선수 단원 복귀 제안 누락");
  const errorIds: string[] = errors.map(claim => claim.id);
  const proposal: WeeklyProposal = { kind: "weekly-review", claimIds: errorIds, items: [
    { unitId: unit.unitId, targetUnitId: unit.unitId, action: "add-practice", estimatedMinutes: 20, activity: "같은 분모 덧셈을 새 예시로 설명", claimIds: errorIds },
    { unitId: unit.unitId, targetUnitId: base.unit.unitId, action: "return-to-prerequisite", estimatedMinutes: 20, activity: "분모의 의미를 새 조각 예시로 확인", claimIds: errorIds },
  ], roommate: roommateFixture(unit.unitId, initial.context.sources), uncertainty: ["선수 개념 부족이 원인인지는 새 답안으로 확인해야 해요."], requiresConfirmation: true };
  const save = (value: WeeklyProposal): Promise<unknown> => saveWeeklyWorkspace(db, bucket, command(owner, initial.version), weeklyId, { availableMinutes: 30, proposal: value, notes: "주간 배정 저장 시험" });
  await denied(() => save({ ...proposal, items: [{ ...proposal.items[1], claimIds: [errorIds[0]] }] }), "weekly.plan-prerequisite-evidence");
  await denied(() => save({ ...proposal, items: [{ ...proposal.items[1], targetUnitId: unit.unitId }] }), "weekly.plan-prerequisite-evidence");
  await denied(() => save({ ...proposal, items: [{ ...proposal.items[0], action: "increase-difficulty" }] }), "weekly.plan-independent-required");
  await denied(() => save({ ...proposal, roommate: { ...proposal.roommate, facts: [{ ...proposal.roommate.facts[0], content: proposal.roommate.analogy.example }] } }), "weekly.roommate-checked-fact-quote");
  await denied(() => save({ ...proposal, roommate: { ...proposal.roommate, facts: [{ ...proposal.roommate.facts[0], content: "원문에 없는 단정", quote: "원문에 없는 단정" }] } }), "weekly.roommate-source-quote");
  await denied(() => save({ ...proposal, roommate: { ...proposal.roommate, analogy: { ...proposal.roommate.analogy, limitations: [] } } }), "schema");
  check(JSON.stringify(await readWeeklyWorkspace(db, owner, weeklyId)) === JSON.stringify(initial), "잘못된 주간 제안의 부분 저장");
  await save(proposal);
  const saved = await readWeeklyWorkspace(db, owner, weeklyId);
  check(saved.claims.every(claim => errors.some(error => JSON.stringify(error) === JSON.stringify(claim))), "주간 저장 시 원본 답안·공식 결과 연결 변경");
  check(saved.proposal !== null, "주간 제안 저장 누락"); if (!saved.proposal) throw new Error("주간 제안 누락");
  const allocation = allocateWeeklyProposal(saved.proposal, saved.context);
  check(allocation.estimatedMinutes === 40 && allocation.allocatedMinutes === 20 && allocation.items[0].item.action === "return-to-prerequisite" && allocation.items[1].status === "unassigned", "제안 순서가 선수 복귀 우선순위·가용 시간을 위반");
  await setWeeklyTime(db, bucket, command(owner, saved.version), weeklyId, 0);
  const zero = await readWeeklyWorkspace(db, owner, weeklyId);
  if (!zero.proposal) throw new Error("0분 편집 중 제안 소실");
  check(allocateWeeklyProposal(zero.proposal, zero.context).items.every(item => item.allocatedMinutes === 0 && item.status === "unassigned"), "0분 편집 후 실행 가능으로 오표시");
  await setWeeklyTime(db, bucket, command(owner, zero.version), weeklyId, 30);
  const ready = await readWeeklyWorkspace(db, owner, weeklyId);
  await confirmWeeklyWorkspace(db, bucket, command(owner, ready.version), { id: weeklyId, expectedVersion: ready.version, fingerprint: ready.fingerprint, businessKey: weeklyBusinessKey(ready) }, Date.now());
  const confirmed = await readWeeklyWorkspace(db, owner, weeklyId);
  if (!confirmed.confirmedVersionId) throw new Error("주간 확정본 누락");
  const frozen = await readWeeklyFrozen(db, bucket, owner, confirmed.confirmedVersionId);
  check(frozen.current && frozen.exportState === "pending" && frozen.state.proposal?.roommate.analogy.distinction === "analogy-not-established-fact" && frozen.state.proposal.roommate.analogy.limitations.length > 0 && frozen.state.proposal.roommate.facts[0].status === "source-checked", "확정본의 사실·비유 한계 구분 소실");
  const exported = await exportWeeklySummary(db, owner, confirmed.confirmedVersionId);
  check(exported.nextActions.includes("배정 20분") && exported.nextActions.includes("미배정 · 같은 분모") && !JSON.stringify(exported).includes(proposal.roommate.analogy.example), "확정 내보내기의 시간 배정·비유 분리 오류");
  check(errors.every(claim => frozen.state.claims.some(savedClaim => JSON.stringify(savedClaim) === JSON.stringify(claim))), "확정 주간 기록의 원본 오답·결과 버전 계보 소실");
  const after = await readResultSnapshot(db, owner, rootSession);
  check(after.draft.confirmation?.judgment.performance === "독립 수행", "주간 조정 제안이 이전 선수 단원의 실제 성과를 덮어씀");
  return ["stored-two-distinct-incorrect-answers", "confirmed-prerequisite-relation-return", "single-error-cannot-trigger-prerequisite-return", "unrelated-prerequisite-target-denied", "incorrect-answers-cannot-promote-difficulty", "analogy-cannot-be-stored-as-source-checked-fact", "fabricated-source-quote-denied", "analogy-limitations-required", "invalid-weekly-edits-preserve-state", "saved-answer-and-official-result-lineage", "prerequisite-priority-and-unassigned-overflow", "stored-zero-time-all-unassigned", "frozen-facts-analogy-and-limitations-preserved", "export-time-allocation-without-analogy-as-fact", "frozen-exact-incorrect-answer-evidence", "weekly-proposal-preserves-prior-performance"];
}
async function fetch(request: Request, environment: Readonly<{ DB: D1Database; BUCKET: R2Bucket }>): Promise<Response> {
  try { return await runLibrarianFixture(request, environment, verify); }
  catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const causes: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) { causes.push(current.message); current = current.cause; }
    return Response.json({ causes }, { status: 500 });
  }
}
const worker: Readonly<{ fetch: typeof fetch }> = { fetch };
export default worker;
