import { verifyUsageDashboard } from "./dashboard-usage-worker";
import { runLibrarianFixture } from "./librarian-worker";
import { readLearningDashboard } from "../../db/repositories/dashboard";
import { readCurrentTutorRecord } from "../../db/repositories/tutor-start";
import { getStudyScope, createStudyScope } from "../../db/repositories/study-scopes";
import { createTutor, getTutor } from "../../db/repositories/tutor";
import { dispatchTutorAction, submitStoredTutorAnswer, saveStoredTutorDraft } from "../../db/repositories/tutor-actions";
import { beginStoredTutorAi, processTutorAi, tutorContext, tutorRequest, dispatchTutor } from "../../lib/tutor/ai";
import { learningRuntimeFixture } from "./learning-ai-runtime";
import { tutorOutputFixture } from "./tutor-output";
import { readResultSnapshot } from "../../db/repositories/result-draft";
import { confirmSessionResult } from "../../db/repositories/result-confirmation";
import { readReviewPlans, chooseReviewSchedule } from "../../db/repositories/review-policy";
import { instant } from "../../lib/reviews/calendar";
import { recordId, seoulStudyDate } from "../../lib/domain/contracts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts";
import { isDomainFailure } from "../../db/repositories/atomic";

function check(value: boolean, message: string): void { if (!value) throw new Error(message); }
async function verify(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, scopeId: string): Promise<readonly string[]> {
  const id = (): ReturnType<typeof recordId.parse> => recordId.parse(crypto.randomUUID());
  const cmd = (expectedVersion: number): Command => ({ owner, requestKey: crypto.randomUUID(), expectedVersion });
  const now: number = Date.now();
  const scope = await getStudyScope(db, owner, scopeId);
  const boundary = await readLearningDashboard(db, bucket, owner, Date.parse("2026-10-24T14:59:59Z"));
  check(boundary.today === "2026-10-24" && boundary.scopes.some(item => item.id === scopeId && item.current) && boundary.sessions.length === 0, "서울 날짜의 오늘 범위·빈 회차 조회 실패");
  const next = await readLearningDashboard(db, bucket, owner, Date.parse("2026-10-24T15:00:00Z"));
  check(next.today === "2026-10-25" && next.scopes.length === 0, "서울 자정 경계 실패");
  const other = await readLearningDashboard(db, bucket, { realm: "sites", userId: "other-owner" }, now);
  check(other.sessions.length + other.scopes.length + other.results.length + other.reviews.length === 0, "다른 소유자 데이터 노출");
  const start = { id: id(), scopeId, questionId: id(), attemptId: id() };
  await createTutor(db, bucket, cmd(1), start, now);
  let state = await getTutor(db, owner, start.id);
  const active = await readLearningDashboard(db, bucket, owner, now);
  check(active.sessions.length === 1 && active.sessions[0].id === start.id, "진행 중 회차 누락");
  await dispatchTutorAction(db, bucket, cmd(state.version), { action: "direct", id: start.id, expectedVersion: state.version }, now);
  const hidden = await readLearningDashboard(db, bucket, owner, now);
  check(hidden.visibility === "hidden-recall" && hidden.scopes.length + hidden.results.length + hidden.reviews.length === 0 && hidden.sessions[0].title === "진행 중인 학습", "인출 중 대시보드 정보 유출");
  state = await getTutor(db, owner, start.id);
  const badBucket: R2Bucket = new Proxy(bucket, { get(): never { throw new Error("fixture R2 unavailable"); } });
  const badWriteDb: D1Database = new Proxy(db, { get(target, property, receiver): unknown { if (property === "prepare") return (): never => { throw new Error("fixture storage unavailable"); }; return Reflect.get(target, property, receiver); } });
  const manualDraft = { text: "파일·Google·AI 없이 직접 작성한 답안", fileIds: [] };
  await saveStoredTutorDraft(db, badBucket, cmd(state.version), start.id, manualDraft);
  state = await getTutor(db, owner, start.id);
  check(state.draft.text === manualDraft.text, "R2 없이 텍스트 초안 저장 실패");
  let saveRejected: boolean = false;
  try { await saveStoredTutorDraft(badWriteDb, badBucket, cmd(state.version), start.id, { text: "저장 실패 답안", fileIds: [] }); } catch (error: unknown) { if (!isDomainFailure(error) || error.code !== "storage_failure") throw error; saveRejected = true; }
  check(saveRejected && (await getTutor(db, owner, start.id)).draft.text === manualDraft.text, "D1 실패를 저장 성공으로 처리함");
  await submitStoredTutorAnswer(db, bucket, cmd(state.version), start.id, id(), { text: "분수는 전체를 같은 크기로 나눈 것 중 선택한 부분입니다.", fileIds: [] }, now);
  const ai = learningRuntimeFixture(db, owner, async () => tutorContext(await getTutor(db, owner, start.id)), async () => tutorOutputFixture(await getTutor(db, owner, start.id)));
  async function generate(action: "diagnose" | "variation"): Promise<void> {
    state = await getTutor(db, owner, start.id); await beginStoredTutorAi(db, bucket, cmd(state.version), start.id, action);
    state = await getTutor(db, owner, start.id); state = await processTutorAi(ai.runtime, bucket, owner, start.id, ai.pricing, tutorRequest(state, []), dispatchTutor, new AbortController().signal);
  }
  await generate("diagnose"); await generate("variation");
  await submitStoredTutorAnswer(db, bucket, cmd(state.version), start.id, id(), { text: "2/5", fileIds: [] }, now);
  await generate("diagnose");
  const snapshot = await readResultSnapshot(db, owner, start.id);
  await confirmSessionResult(db, cmd(state.version), { id: start.id, expectedVersion: state.version, expectedSessionVersion: snapshot.sessionVersion, expectedOfficialVersion: snapshot.draft.officialVersion, fingerprint: snapshot.draft.fingerprint }, now);
  const before = await db.prepare("SELECT count(*) AS n FROM atomic_requests").first<number>("n");
  const official = await readCurrentTutorRecord(db, owner, state.start.bundle.unit.unitId);
  const saved = await readLearningDashboard(db, bucket, owner, now);
  check(saved.sessions.length === 0 && JSON.stringify(saved.results[0].record) === JSON.stringify(official), "확정 진도·수행·다음 행동 불일치");
  check(saved.reviews.length === 1 && saved.reviews[0].dueState === "proposed", "복습 일정 수락 대기 누락");
  check((await db.prepare("SELECT count(*) AS n FROM atomic_requests").first<number>("n")) === before, "대시보드 조회가 상태를 변경함");
  const stale = await readLearningDashboard(db, bucket, owner, Date.parse("2026-10-24T12:00:00Z"));
  check(stale.scopes[0].current === false, "확정 결과 변경 뒤 이전 범위를 최신으로 표시함");
  const plan = (await readReviewPlans(db, owner, instant.parse(new Date(now).toISOString()), "Asia/Seoul"))[0];
  await chooseReviewSchedule(db, cmd(plan.version), { id: plan.id, expectedVersion: plan.version, type: plan.task.type, conditions: plan.proposal.conditions, dueDate: seoulStudyDate(now), reason: "대시보드 날짜 경계 시험" }, now);
  check((await readLearningDashboard(db, bucket, owner, now)).reviews[0].dueState === "today", "오늘 복습 누락");
  check((await readLearningDashboard(db, bucket, owner, now + 86_400_000)).reviews[0].dueState === "overdue", "지연 복습 누락");
  const badDb: D1Database = new Proxy(db, { get(target, property, receiver): unknown { if (property === "prepare") return (): never => { throw new Error("fixture storage unavailable"); }; return Reflect.get(target, property, receiver); } });
  let rejected: boolean = false;
  try { await readLearningDashboard(badDb, bucket, owner, now); } catch (error: unknown) { if (!isDomainFailure(error) || error.code !== "storage_failure") throw error; rejected = true; }
  check(rejected, "조회 실패를 빈 목록으로 표시함");
  await createStudyScope(db, bucket, cmd(1), { ...scope.input, id: id(), date: "2026-10-25" });
  const usageChecks = await verifyUsageDashboard(db, now);
  return [...usageChecks, "availability-text-draft-no-r2-ai-google", "availability-failed-save-not-confirmed", "dashboard-seoul-midnight", "dashboard-owner-isolation", "dashboard-active-and-empty-sessions", "dashboard-hidden-recall-no-source-or-next-action", "dashboard-official-progress-performance-next-action-exact", "dashboard-read-only", "dashboard-stale-scope", "dashboard-proposed-today-overdue-contract", "dashboard-storage-error-not-empty"];
}
const worker = { async fetch(request: Request, env: Readonly<{ DB: D1Database; BUCKET: R2Bucket }>): Promise<Response> { return runLibrarianFixture(request, env, verify); } };
export default worker;
