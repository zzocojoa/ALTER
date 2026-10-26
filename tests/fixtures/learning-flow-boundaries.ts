import { createTutor, getTutor } from "../../db/repositories/tutor";
import { createEditor } from "../../db/repositories/editor";
import { dispatchTutorAction, saveStoredTutorDraft, submitStoredTutorAnswer } from "../../db/repositories/tutor-actions";
import { readAiRequestStatus } from "../../db/repositories/ai-status";
import { readResultSnapshot } from "../../db/repositories/result-draft";
import { recordId, seoulStudyDate } from "../../lib/domain/contracts";
import { beginStoredTutorAi, tutorContext, tutorRequest, processTutorAi, dispatchTutor } from "../../lib/tutor/ai";
import { publicTutorView } from "../../lib/tutor/view";
import type { LearningOutput } from "../../lib/ai/learning-contract";
import type { TutorState } from "../../lib/tutor/contracts";
import { learningRuntimeFixture } from "./learning-ai-runtime";
import { prepareLearningFlow, flowCommand, requireFlow } from "./learning-flow-setup";
import type { LearningFlowEnvironment } from "./learning-flow-setup";
import type { LearningFlowCase } from "./learning-flow-cases";

function id(): ReturnType<typeof recordId.parse> { return recordId.parse(crypto.randomUUID()); }
async function denied(action: () => Promise<unknown>, code: string): Promise<void> {
  try { await action(); }
  catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === code) return;
    throw error;
  }
  throw new Error(`필수 거부 누락: ${code}`);
}

/** 서울 자정 재전송과 오인용 응답을 실제 저장소·비용·확정 경계까지 대조합니다. */
export async function verifyLearningBoundaries(env: LearningFlowEnvironment, scenario: LearningFlowCase): Promise<readonly string[]> {
  const flow = await prepareLearningFlow(env, scenario);
  const input = { id: id(), scopeId: recordId.parse(flow.scopeId), questionId: id(), attemptId: id() };
  const command = flowCommand(flow.owner, 1);
  const before: number = Date.parse(`${seoulStudyDate(Date.now())}T23:59:59.999+09:00`);
  const after: number = before + 1;
  requireFlow(seoulStudyDate(before) !== seoulStudyDate(after), "서울 자정 시험 시각");
  const first = await createTutor(env.DB, env.BUCKET, command, input, before);
  const repeated = await createTutor(env.DB, env.BUCKET, command, input, after);
  requireFlow(first.requestId === repeated.requestId && first.entityId === repeated.entityId, "자정 재전송의 동일 영수증");
  const duplicate = { ...input, id: id(), questionId: id(), attemptId: id() };
  await denied(() => createTutor(env.DB, env.BUCKET, flowCommand(flow.owner, 1), duplicate, after), "version_conflict");
  await denied(() => createEditor(env.DB, env.BUCKET, flowCommand(flow.owner, 1), duplicate, after), "version_conflict");
  const sessions = await env.DB.prepare("SELECT id,study_date AS studyDate FROM sessions WHERE owner_id=?").bind(flow.owner.userId).all<{ id: string; studyDate: string }>();
  requireFlow(sessions.results.length === 1 && sessions.results[0].id === input.id && sessions.results[0].studyDate === seoulStudyDate(before), "자정 후 중복 회차 차단·원래 학습일 보존");
  let state: TutorState = await getTutor(env.DB, flow.owner, input.id);
  await dispatchTutorAction(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), { action: "direct", id: input.id, expectedVersion: state.version }, after);
  state = await getTutor(env.DB, flow.owner, input.id);
  await saveStoredTutorDraft(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), input.id, { text: scenario.explanationAnswer, fileIds: [] });
  state = await getTutor(env.DB, flow.owner, input.id);
  await submitStoredTutorAnswer(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), input.id, id(), state.draft, after);
  state = await getTutor(env.DB, flow.owner, input.id);
  await beginStoredTutorAi(env.DB, env.BUCKET, flowCommand(flow.owner, state.version), input.id, "diagnose");
  const pending: TutorState = await getTutor(env.DB, flow.owner, input.id);
  if (!pending.pending || !pending.currentAnswerId) throw new Error("오인용 시험의 저장 답안·평가 요청 없음");
  const invalid: LearningOutput["result"] = { kind: "tutor-diagnosis", questionId: pending.question.id, answerId: pending.currentAnswerId, readability: "readable", correct: true, observation: "원문에 없는 인용을 사용한 모의 긍정 판정", citations: [{ sourceRefId: pending.start.bundle.sources[0].id, quote: "선택 원문에는 존재하지 않는 잘못된 인용입니다." }], needsHelp: false };
  const fixture = learningRuntimeFixture(env.DB, flow.owner, async () => tutorContext(await getTutor(env.DB, flow.owner, input.id)), async () => invalid);
  const run = (): Promise<TutorState> => processTutorAi(fixture.runtime, env.BUCKET, flow.owner, input.id, fixture.pricing, tutorRequest(pending, []), dispatchTutor, new AbortController().signal);
  await denied(run, "ai_semantic_invalid");
  const rejected: TutorState = await getTutor(env.DB, flow.owner, input.id);
  requireFlow(rejected.version === pending.version && rejected.diagnosis === null && rejected.diagnoses.length === 0 && rejected.answers.at(-1)?.text === scenario.explanationAnswer, "오인용 미적용·원본 답안 보존");
  const calls = await readAiRequestStatus(env.DB, flow.owner, pending.pending.key);
  requireFlow(calls.length === 1 && calls[0].stage === "invalid" && calls[0].actualUnits !== null && calls[0].actualUnits > 0, "오인용도 모의 소비 비용 기록 보존");
  await denied(run, "result_unknown");
  requireFlow(fixture.generations() === 1, "오인용 재조회가 자동 재생성을 일으키지 않음");
  const result = await readResultSnapshot(env.DB, flow.owner, input.id);
  requireFlow(!result.draft.canConfirm && !result.draft.judgment.unitPassed && result.draft.judgment.delayedRecall === "미확인" && publicTutorView(rejected).diagnosis === null, "오인용 표시·확정·독립 수행 승격 차단");
  await dispatchTutorAction(env.DB, env.BUCKET, flowCommand(flow.owner, rejected.version), { action: "revise", id: input.id, expectedVersion: rejected.version, attemptId: id() }, after);
  const recovered: TutorState = await getTutor(env.DB, flow.owner, input.id);
  requireFlow(recovered.phase === "awaiting-answer" && recovered.pending === null && recovered.draft.text === scenario.explanationAnswer && recovered.answers.length === 1, "오인용 후 새 입력 재개·이전 답안 보존");
  return ["seoul-midnight-identical-request-single-receipt", "seoul-midnight-new-tutor-and-editor-rejected-while-active", "seoul-midnight-original-study-date-and-single-session", "invalid-citation-rejected-by-sdk-semantic-pipeline", "invalid-citation-retains-answer-without-diagnosis", "invalid-citation-consumption-retained", "invalid-citation-replay-does-not-regenerate", "invalid-citation-cannot-confirm-or-promote-performance", "invalid-citation-recovery-preserves-answer"];
}
