import { z } from "zod";
import { verifyLearningBoundaries } from "./learning-flow-boundaries";
import { createTutor, getTutor } from "../../db/repositories/tutor";
import { dispatchTutorAction, saveStoredTutorDraft, submitStoredTutorAnswer } from "../../db/repositories/tutor-actions";
import { createEditor, submitStoredEditorDraft } from "../../db/repositories/editor";
import { beginStoredEditorFeedback } from "../../db/repositories/editor-feedback";
import { saveStoredEditorRevisionDraft, submitStoredEditorRevision } from "../../db/repositories/editor-revision";
import { beginStoredEditorReview } from "../../db/repositories/editor-review";
import { readResultSnapshot } from "../../db/repositories/result-draft";
import { confirmSessionResult } from "../../db/repositories/result-confirmation";
import { readSessionResume } from "../../db/repositories/session-resume";
import { isDomainFailure } from "../../db/repositories/atomic";
import { recordId } from "../../lib/domain/contracts";
import type { SiteIdentity } from "../../lib/domain/contracts";
import { publicTutorView } from "../../lib/tutor/view";
import { publicEditorView } from "../../lib/editor/view";
import { tutorIndependentCandidate } from "../../lib/tutor/variation";
import { beginStoredTutorAi, tutorContext, tutorRequest, processTutorAi, dispatchTutor } from "../../lib/tutor/ai";
import type { TutorState } from "../../lib/tutor/contracts";
import { editorRequest } from "../../lib/editor/request";
import type { LearningOutput } from "../../lib/ai/learning-contract";
import type { ResultRequest } from "../../lib/results/contracts";
import { learningRuntimeFixture } from "./learning-ai-runtime";
import { editorFeedbackFixture, editorResolvedFixture } from "./editor-output";
import { learningFlowCases } from "./learning-flow-cases";
import type { LearningFlowCase } from "./learning-flow-cases";
import { prepareLearningFlow, selectLearningFlowScope, flowCommand, requireFlow } from "./learning-flow-setup";
import type { LearningFlowEnvironment, PreparedLearningFlow } from "./learning-flow-setup";

function id(): ReturnType<typeof recordId.parse> { return recordId.parse(crypto.randomUUID()); }
async function denied(action: () => Promise<unknown>, code: string): Promise<void> {
  try { await action(); }
  catch (error: unknown) { if (isDomainFailure(error) && error.code === code) return; throw error; }
  throw new Error(`필수 거부 누락: ${code}`);
}

/** 평가를 일부러 낙관적으로 고정해도 복사 답안·도움 이력으로 독립성이 차단되어야 합니다. */
function mockLearningOutput(state: TutorState, scenario: LearningFlowCase): LearningOutput["result"] {
  const citations = [{ sourceRefId: state.start.bundle.sources[0].id, quote: state.start.bundle.sources[0].evidence }];
  if (state.pending?.kind === "editor-draft-feedback") return editorFeedbackFixture(state);
  if (state.pending?.kind === "editor-revision-review") return editorResolvedFixture(state);
  if (state.pending?.kind === "tutor-lesson") return { kind: "tutor-lesson", explanation: { text: scenario.definition, citations } };
  if (state.pending?.kind === "tutor-variation") return { kind: "tutor-variation", originalQuestionId: state.question.id, prompt: state.question.mode === "new-condition" ? scenario.followupVariation : scenario.variation, changedCondition: { before: state.question.prompt, after: state.question.mode === "new-condition" ? scenario.followupCondition : scenario.changedCondition, reason: "같은 개념을 다른 수치 조건에서 적용합니다." }, citations };
  if (state.pending?.kind === "tutor-diagnosis" && state.currentAnswerId) return { kind: "tutor-diagnosis", questionId: state.question.id, answerId: state.currentAnswerId, readability: "readable", correct: true, observation: "통합 경계 검증을 위한 모의 긍정 판정", citations, needsHelp: false };
  throw new Error(`통합 검증의 예상하지 않은 응답 종류: ${state.pending?.kind}`);
}

export async function completePending(env: LearningFlowEnvironment, flow: PreparedLearningFlow, sessionId: string, scenario: LearningFlowCase): Promise<TutorState> {
  const state: TutorState = await getTutor(env.DB, flow.owner, sessionId);
  const runtime = learningRuntimeFixture(env.DB, flow.owner, async () => tutorContext(await getTutor(env.DB, flow.owner, sessionId)), async () => mockLearningOutput(await getTutor(env.DB, flow.owner, sessionId), scenario));
  const request = state.pending?.kind.startsWith("editor-") ? editorRequest(state, []) : tutorRequest(state, []);
  return processTutorAi(runtime.runtime, env.BUCKET, flow.owner, sessionId, runtime.pricing, request, dispatchTutor, new AbortController().signal);
}

async function confirmResult(env: LearningFlowEnvironment, owner: SiteIdentity, sessionId: string): Promise<void> {
  const snapshot = await readResultSnapshot(env.DB, owner, sessionId);
  const request: ResultRequest = { id: recordId.parse(sessionId), expectedVersion: snapshot.state.version, expectedSessionVersion: snapshot.sessionVersion, expectedOfficialVersion: snapshot.draft.officialVersion, fingerprint: snapshot.draft.fingerprint };
  const command = flowCommand(owner, snapshot.state.version);
  await confirmSessionResult(env.DB, command, request, Date.now());
  await confirmSessionResult(env.DB, command, request, Date.now());
  const receiptCount: number | null = await env.DB.prepare("SELECT count(*) AS n FROM session_confirmations WHERE owner_id=? AND session_id=?").bind(owner.userId, sessionId).first<number>("n");
  requireFlow(receiptCount === 1, "재전송 후 회차 확정 단일성");
}

async function verifyTutor(env: LearningFlowEnvironment, flow: PreparedLearningFlow, scenario: LearningFlowCase): Promise<string> {
  const sessionId: ReturnType<typeof id> = id();
  await createTutor(env.DB, env.BUCKET, flowCommand(flow.owner, 1), { id: sessionId, scopeId: recordId.parse(flow.scopeId), questionId: id(), attemptId: id() }, Date.now());
  await beginStoredTutorAi(env.DB, env.BUCKET, flowCommand(flow.owner, 1), sessionId, "lesson");
  let state: TutorState = await completePending(env, flow, sessionId, scenario);
  requireFlow(publicTutorView(state).lesson?.text === scenario.definition, "소개 설명 표시");
  await dispatchTutorAction(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), { action: "recall", id: sessionId, expectedVersion: state.version }, Date.now());
  state = await getTutor(env.DB, flow.owner, sessionId);
  const visible = publicTutorView(state);
  requireFlow(visible.hidden && visible.sources.length === 0 && visible.lesson === null && visible.answers.length === 0 && state.question.prompt === scenario.question, "인출 원문·AI 설명 가림");
  await denied(() => beginStoredTutorAi(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, "diagnose"), "version_conflict");
  const staleVersion: number = state.version;
  await saveStoredTutorDraft(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, { text: scenario.explanationAnswer, fileIds: [] });
  state = await getTutor(env.DB, flow.owner, sessionId);
  requireFlow(state.draft.text === scenario.explanationAnswer && state.phase === "awaiting-answer", "질문 뒤 입력 대기·서버 재조회");
  await denied(() => saveStoredTutorDraft(env.DB, env.BUCKET, flowCommand(flow.owner, staleVersion), sessionId, { text: "오래된 탭", fileIds: [] }), "version_conflict");
  const answerId = id(); const submit = flowCommand(flow.owner, state.version);
  await submitStoredTutorAnswer(env.DB, env.BUCKET, submit, sessionId, answerId, state.draft, Date.now());
  await submitStoredTutorAnswer(env.DB, env.BUCKET, submit, sessionId, answerId, state.draft, Date.now());
  state = await getTutor(env.DB, flow.owner, sessionId);
  requireFlow(state.answers.length === 1 && state.pending === null, "답안 우선 저장·중복 단일성");
  await beginStoredTutorAi(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, "diagnose");
  await completePending(env, flow, sessionId, scenario);
  const partial = await readResultSnapshot(env.DB, flow.owner, sessionId);
  requireFlow(partial.draft.judgment.explanation?.accepted === true && !partial.draft.judgment.unitPassed && partial.draft.judgment.variation === null, "설명만으로 단원 통과 금지");
  await confirmResult(env, flow.owner, sessionId);
  requireFlow((await getTutor(env.DB, flow.owner, sessionId)).phase === "finished", "공식 확정과 회차 종료");
  return sessionId;
}

async function rejectMissingReason(env: LearningFlowEnvironment, flow: PreparedLearningFlow, state: TutorState, scenario: LearningFlowCase): Promise<void> {
  try { await submitStoredEditorRevision(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), state.id, { answerId: id(), attemptId: id(), draft: { text: scenario.revision, fileIds: [] }, reason: "", submittedAt: Date.now() }); }
  catch (error: unknown) {
    if (!(error instanceof z.ZodError) || !error.issues.some((issue): boolean => issue.path.includes("reason"))) throw error;
    requireFlow((await getTutor(env.DB, flow.owner, state.id)).version === state.version, "수정 이유 누락의 상태 불변");
    return;
  }
  throw new Error("이유 없는 Editor 수정이 저장됐습니다.");
}

async function verifyEditor(env: LearningFlowEnvironment, flow: PreparedLearningFlow, scenario: LearningFlowCase, tutorId: string): Promise<string> {
  const sessionId: ReturnType<typeof id> = id();
  await createEditor(env.DB, env.BUCKET, flowCommand(flow.owner, 1), { id: sessionId, scopeId: recordId.parse(flow.scopeId), questionId: id(), attemptId: id() }, Date.now());
  let state: TutorState = await getTutor(env.DB, flow.owner, sessionId);
  requireFlow(state.start.latest?.progress === "진행 중", "Tutor 확정 결과를 Editor 다음 회차에서 재개");
  await submitStoredEditorDraft(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, id(), { text: "계산 순서를 반대로 적용한 초안입니다.", fileIds: [] }, Date.now());
  state = await getTutor(env.DB, flow.owner, sessionId);
  await beginStoredEditorFeedback(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId);
  state = await completePending(env, flow, sessionId, scenario);
  requireFlow(state.editor?.phase === "awaiting-revision" && state.editor.feedbacks[0].itemIds.length === 1 && state.pending === null, "핵심 피드백 한 개 후 직접 수정 대기");
  await rejectMissingReason(env, flow, state, scenario);
  await saveStoredEditorRevisionDraft(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, { text: scenario.revision, fileIds: [] }, scenario.reason);
  state = await getTutor(env.DB, flow.owner, sessionId);
  requireFlow(state.editor?.draftReason === scenario.reason && state.editor.phase === "awaiting-revision", "수정 초안·이유 재조회 및 자동 완료 금지");
  await submitStoredEditorRevision(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, { answerId: id(), attemptId: id(), draft: state.draft, reason: scenario.reason, submittedAt: Date.now() });
  state = await getTutor(env.DB, flow.owner, sessionId);
  await beginStoredEditorReview(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId);
  state = await completePending(env, flow, sessionId, scenario);
  requireFlow(state.editor?.phase === "ready-for-recheck" && state.answers.at(-1)?.helped === true && tutorIndependentCandidate(state) === null, "개선 답안의 독립 수행 승격 금지");
  await beginStoredTutorAi(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, "variation");
  state = await completePending(env, flow, sessionId, scenario);
  requireFlow(publicEditorView(state).versions.length === 0 && publicEditorView(state).feedbacks.length === 0 && state.variations[0].helpEventIds.length === 2 && state.editor?.feedbacks.every((feedback): boolean => state.variations[0].helpEventIds.includes(feedback.helpEventId)) === true, "새 조건의 과거 답안 가림·도움 연결 보존");
  await submitStoredTutorAnswer(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, id(), { text: scenario.revision, fileIds: [] }, Date.now());
  state = await getTutor(env.DB, flow.owner, sessionId);
  await beginStoredTutorAi(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, "diagnose");
  state = await completePending(env, flow, sessionId, scenario);
  requireFlow(state.diagnosis?.correct === true && tutorIndependentCandidate(state) === null && !(await readResultSnapshot(env.DB, flow.owner, sessionId)).draft.judgment.unitPassed, "모의 정답 판정이어도 이전 답안 복사는 독립성 거부");
  await dispatchTutorAction(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), { action: "revise", id: sessionId, expectedVersion: state.version, attemptId: id() }, Date.now());
  state = await getTutor(env.DB, flow.owner, sessionId);
  await submitStoredTutorAnswer(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, id(), { text: scenario.variationAnswer, fileIds: [] }, Date.now());
  state = await getTutor(env.DB, flow.owner, sessionId);
  await beginStoredTutorAi(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, "diagnose");
  state = await completePending(env, flow, sessionId, scenario);
  requireFlow(tutorIndependentCandidate(state) !== null && state.editor?.versions.length === 2 && state.editor.versions[1].reason === scenario.reason, "새 조건 독립 답안·원래 수정 이력 보존");
  const repeated = await readResultSnapshot(env.DB, flow.owner, sessionId);
  requireFlow(!repeated.draft.judgment.unitPassed && repeated.draft.judgment.evidence.some((evidence): boolean => evidence.answerId === state.currentAnswerId && evidence.reasons.some((reason): boolean => reason.includes("동일 문제의 재시도"))), "같은 변형 문제의 재시도도 첫 독립 수행으로 승격 금지");
  await beginStoredTutorAi(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, "variation");
  state = await completePending(env, flow, sessionId, scenario);
  requireFlow(state.question.prompt === scenario.followupVariation && publicEditorView(state).versions.length === 0, "실제로 다른 조건으로 다시 출제");
  await submitStoredTutorAnswer(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, id(), { text: scenario.followupAnswer, fileIds: [] }, Date.now());
  state = await getTutor(env.DB, flow.owner, sessionId);
  await beginStoredTutorAi(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), sessionId, "diagnose");
  state = await completePending(env, flow, sessionId, scenario);
  requireFlow(tutorIndependentCandidate(state) !== null, "새 문제 첫 독립 수행 후보");
  const final = await readResultSnapshot(env.DB, flow.owner, sessionId);
  requireFlow(final.draft.judgment.unitPassed && final.draft.judgment.explanation?.sessionId === tutorId && final.draft.judgment.variation?.sessionId === sessionId && final.draft.judgment.delayedRecall === "미확인", "두 회차의 독립 설명·변형 근거 결합 및 지연 재현 분리");
  await confirmResult(env, flow.owner, sessionId);
  const resumed = await readSessionResume(env.DB, flow.owner, sessionId);
  requireFlow(resumed.state.phase === "finished" && resumed.latest?.progress === "완료" && resumed.latest.performance === "독립 수행" && resumed.reviews.length > 0, "최종 결과·종료·복습 연결 재조회");
  return sessionId;
}

async function runScenario(request: Request, env: LearningFlowEnvironment): Promise<Response> {
  const domain: string = new URL(request.url).pathname.slice(1);
  const scenario: LearningFlowCase | undefined = learningFlowCases.find((item): boolean => item.domain === domain);
  if (request.method !== "POST" || !scenario) return Response.json({ error: "지원하지 않는 통합 시험 요청", domain }, { status: 400 });
  const flow = await prepareLearningFlow(env, scenario);
  const tutorId: string = await verifyTutor(env, flow, scenario);
  await denied(() => createEditor(env.DB, env.BUCKET, flowCommand(flow.owner, 1), { id: id(), scopeId: recordId.parse(flow.scopeId), questionId: id(), attemptId: id() }, Date.now()), "reference_conflict");
  const currentFlow = await selectLearningFlowScope(env, flow, scenario);
  const editorId: string = await verifyEditor(env, currentFlow, scenario, tutorId);
  const boundaries: readonly string[] = await verifyLearningBoundaries(env, scenario);
  requireFlow((await env.DB.prepare("PRAGMA foreign_key_check").all()).results.length === 0, "전체 외래 키 무결성");
  return Response.json({ status: "passed", environment: "local-workerd-d1-r2", domain, title: scenario.title, providerEvidence: "deterministic-mock-only", sourceKind: "self-authored-utf8-text", actualBrowser: false, actualPhone: false, owner: flow.owner.userId, courseId: flow.courseId, materialId: flow.materialId, sourceId: flow.sourceId, tutorId, editorId, checks: ["advisor-domain-and-unverified-initial-estimates", "same-course-original-registration-r2-utf8-roundtrip", "selected-text-confirmation-source-link", "minimal-library-scope-and-exact-question-practice", "recall-hides-source-and-ai-lesson", "question-waits-no-preanswer-diagnosis", "draft-reload-stale-tab-rejected", "answer-before-ai-idempotent-submit", "explanation-alone-does-not-pass-unit", "old-scope-rejected-after-confirmation-explicit-reselection", "editor-resumes-confirmed-tutor-result", "one-feedback-then-wait-for-revision", "missing-reason-rejected-without-state-change", "revision-and-reason-preserved", "improved-helped-answer-not-independent", "variation-hides-old-work-retains-help-link", "optimistic-grading-cannot-promote-copied-answer", "same-question-retry-not-first-independent-performance", "fresh-distinct-question-then-unassisted-first-answer", "two-session-explanation-and-new-condition-evidence", "delayed-recall-remains-unverified", "final-confirmation-replay-no-duplicate", "finished-result-and-review-server-resume", "foreign-key-integrity", ...boundaries] });
}
async function fetch(request: Request, env: LearningFlowEnvironment): Promise<Response> {
  try { return await runScenario(request, env); }
  catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    const causes: Readonly<{ name: string; message: string; stack: string | undefined }>[] = [];
    let cause: unknown = error;
    while (cause instanceof Error) {
      causes.push({ name: cause.name, message: cause.message, stack: cause.stack });
      cause = cause.cause;
    }
    return Response.json({ path: new URL(request.url).pathname, status: "failed", causes }, { status: 500 });
  }
}
const worker = { fetch };
export default worker;
