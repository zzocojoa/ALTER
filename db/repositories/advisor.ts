import { z } from "zod";
import { advisorState, planProposal } from "../../lib/advisor/contracts.ts";
import type { AdvisorState, AdvisorTurn, PlanProposal, SubmittedDiagnosis } from "../../lib/advisor/contracts.ts";
import type { LearningConditions } from "../../lib/advisor/conditions.ts";
import { availableMinutes } from "../../lib/advisor/conditions.ts";
import { answerDiagnosis, beginAdvisorAi, editAdvisorPlan, finishAdvisorPlan, finishAdvisorTurn, initialAdvisor } from "../../lib/advisor/state.ts";
import { contentHash, domainFailure, recordId, version } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate, readStorage } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

type StateRow = Readonly<{ state: string }>;
type EventKind = "start" | "answer" | "begin" | "turn" | "plan" | "edit" | "confirm";

export async function advisorRecordId(value: string): Promise<string> {
  const hash: string = await contentHash(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function getAdvisor(db: D1Database, owner: SiteIdentity, id: string): Promise<AdvisorState> {
  recordId.parse(id);
  const row: StateRow | null = await readStorage("advisor.get", () => db.prepare("SELECT state FROM advisor_sessions WHERE owner_id=? AND id=?").bind(owner.userId, id).first<StateRow>());
  if (!row) throw domainFailure("reference_conflict", "advisor.get", null);
  return advisorState.parse(JSON.parse(row.state));
}
export async function listAdvisors(db: D1Database, owner: SiteIdentity): Promise<readonly AdvisorState[]> {
  const rows = await readStorage("advisor.list", () => db.prepare("SELECT s.state FROM advisor_sessions s JOIN advisor_events e ON e.owner_id=s.owner_id AND e.session_id=s.id AND e.version=1 WHERE s.owner_id=? ORDER BY e.created_at DESC LIMIT 30").bind(owner.userId).all<StateRow>());
  return rows.results.map((row): AdvisorState => advisorState.parse(JSON.parse(row.state)));
}
/** 요청 당시 버전을 불변 사건에서 읽어 동일 요청 재전송도 같은 내용으로 수렴시킵니다. */
async function previousAdvisor(db: D1Database, cmd: Command, id: string): Promise<AdvisorState> {
  recordId.parse(id); version.parse(cmd.expectedVersion);
  const row: StateRow | null = await readStorage("advisor.version", () => db.prepare("SELECT json_extract(content,'$.state') AS state FROM advisor_events WHERE owner_id=? AND session_id=? AND version=?").bind(cmd.owner.userId, id, cmd.expectedVersion).first<StateRow>());
  if (!row) throw domainFailure("version_conflict", "advisor.version", null);
  return advisorState.parse(JSON.parse(row.state));
}
function eventStatement(db: D1Database, owner: SiteIdentity, requestId: string, state: AdvisorState, kind: EventKind, input: unknown): D1PreparedStatement {
  return db.prepare("INSERT INTO advisor_events (owner_id,id,session_id,version,kind,content,created_at) VALUES (?,?,?,?,?,?,?)").bind(owner.userId, requestId, state.id, state.version, kind, JSON.stringify({ input, state }), Date.now());
}
async function saveTransition(db: D1Database, cmd: Command, state: AdvisorState, kind: EventKind, input: unknown): Promise<Receipt> {
  return executeAtomic(db, cmd, `advisor.${kind}`, input, state.id, state.version, (requestId) => [
    ...guardedUpdate(db, "advisor_sessions", cmd.owner.userId, state.id, cmd.expectedVersion, requestId, 1, "state=?", [JSON.stringify(state)], "1=1", []), eventStatement(db, cmd.owner, requestId, state, kind, input),
  ]);
}
export async function startAdvisor(db: D1Database, cmd: Command, id: string, conditions: LearningConditions): Promise<Receipt> {
  if (cmd.expectedVersion !== 1) throw domainFailure("version_conflict", "advisor.start", null);
  const state: AdvisorState = initialAdvisor(id, conditions);
  return executeAtomic(db, cmd, "advisor.start", conditions, id, 1, (requestId) => [db.prepare("INSERT INTO advisor_sessions (owner_id,id,version,last_request_id,state) VALUES (?,?,1,?,?)").bind(cmd.owner.userId, id, requestId, JSON.stringify(state)), eventStatement(db, cmd.owner, requestId, state, "start", conditions)]);
}
export async function submitAdvisorAnswer(db: D1Database, cmd: Command, id: string, input: SubmittedDiagnosis): Promise<Receipt> {
  const state: AdvisorState = await previousAdvisor(db, cmd, id);
  return saveTransition(db, cmd, answerDiagnosis(state, await advisorRecordId(`${id}:answer:${cmd.requestKey}`), input), "answer", input);
}
export async function beginStoredAdvisorAi(db: D1Database, cmd: Command, id: string): Promise<Receipt> {
  return saveTransition(db, cmd, beginAdvisorAi(await previousAdvisor(db, cmd, id)), "begin", { id });
}
export async function saveAdvisorTurn(db: D1Database, owner: SiteIdentity, state: AdvisorState, output: AdvisorTurn): Promise<Receipt> {
  if (!state.pending) throw domainFailure("version_conflict", "advisor.turn.pending", null);
  const cmd: Command = { owner, requestKey: `${state.pending.key}:complete`, expectedVersion: state.version };
  return saveTransition(db, cmd, finishAdvisorTurn(state, output, await advisorRecordId(`${state.pending.key}:question`)), "turn", output);
}
export async function saveAdvisorPlan(db: D1Database, owner: SiteIdentity, state: AdvisorState, proposal: PlanProposal): Promise<Receipt> {
  if (!state.pending) throw domainFailure("version_conflict", "advisor.plan.pending", null);
  return saveTransition(db, { owner, requestKey: `${state.pending.key}:complete`, expectedVersion: state.version }, finishAdvisorPlan(state, proposal), "plan", proposal);
}
export async function editStoredAdvisorPlan(db: D1Database, cmd: Command, id: string, proposal: PlanProposal): Promise<Receipt> {
  return saveTransition(db, cmd, editAdvisorPlan(await previousAdvisor(db, cmd, id), planProposal.parse(proposal)), "edit", proposal);
}

export const confirmationChoices = z.object({ reviewedVersion: version, reviewedEvidence: z.literal(true), acceptedAssessment: z.literal(true), acceptedScopeAndTime: z.literal(true) }).strict();
export type ConfirmationChoices = Readonly<z.infer<typeof confirmationChoices>>;
/** 정식 과정·단원·계획 버전·검토 선택은 모두 하나의 D1 배치에서 확정합니다. */
export async function confirmAdvisorPlan(db: D1Database, cmd: Command, id: string, input: ConfirmationChoices): Promise<Receipt> {
  const choices: ConfirmationChoices = confirmationChoices.parse(input);
  const previous: AdvisorState = await previousAdvisor(db, cmd, id);
  if (choices.reviewedVersion !== cmd.expectedVersion || previous.phase !== "draft" || previous.pending || !previous.draft) throw domainFailure("version_conflict", "advisor.confirm.review-version", null);
  const draft: PlanProposal = previous.draft;
  if (draft.units.reduce((sum: number, unit): number => sum + unit.minutes, 0) > availableMinutes(previous.conditions)) throw domainFailure("limit_exceeded", "advisor.confirm.time-budget", null);
  const planVersionId: string = await advisorRecordId(`${id}:plan:${previous.version}`);
  const unitIds: string[] = await Promise.all(draft.units.map((unit): Promise<string> => advisorRecordId(`${id}:unit:${unit.key}`)));
  const state: AdvisorState = advisorState.parse({ ...previous, phase: "confirmed", version: previous.version + 1, confirmedPlanVersionId: planVersionId });
  const officialContent = { objective: draft.objective, unitIds, minutesPerWeek: previous.conditions.minutesPerWeek };
  return executeAtomic(db, cmd, "advisor.confirm", choices, id, state.version, (requestId) => [
    ...guardedUpdate(db, "advisor_sessions", cmd.owner.userId, id, cmd.expectedVersion, requestId, 1, "state=?", [JSON.stringify(state)], "json_extract(state,'$.phase')='draft'", []),
    db.prepare("INSERT INTO courses (owner_id,id,version,last_request_id,title) VALUES (?,?,1,?,?)").bind(cmd.owner.userId, id, requestId, previous.conditions.title),
    ...draft.units.map((unit, index): D1PreparedStatement => db.prepare("INSERT INTO units (owner_id,id,version,last_request_id,course_id,ordinal,title) VALUES (?,?,1,?,?,?,?)").bind(cmd.owner.userId, unitIds[index], requestId, id, index + 1, unit.title)),
    db.prepare("INSERT INTO plans (owner_id,id,version,last_request_id,course_id,title) VALUES (?,?,1,?,?,?)").bind(cmd.owner.userId, id, requestId, id, previous.conditions.title),
    db.prepare("INSERT INTO plan_versions (owner_id,id,plan_id,course_id,ordinal,content,confirmed_at) VALUES (?,?,?,?,1,?,?)").bind(cmd.owner.userId, planVersionId, id, id, JSON.stringify(officialContent), Date.now()),
    eventStatement(db, cmd.owner, requestId, state, "confirm", { choices, unitIds, planVersionId, conditions: previous.conditions, diagnosticEstimates: previous.estimates, performance: "미확인" }),
  ]);
}
