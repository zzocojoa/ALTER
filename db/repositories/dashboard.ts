import { z } from "zod";
import { domainFailure, recordId, siteIdentity } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { dashboardResult, dashboardReviews, dashboardScope, dashboardSession, learningDashboard } from "../../lib/dashboard/contracts.ts";
import type { DashboardResult, DashboardScope, DashboardSession, LearningDashboard } from "../../lib/dashboard/contracts.ts";
import { instant, seoulCalendarDate } from "../../lib/reviews/calendar.ts";
import { isDomainFailure, readStorage } from "./atomic.ts";
import { readReviewOverview } from "./review-overview.ts";
import { getStudyScope, requireCurrentScope } from "./study-scopes.ts";
import { readCurrentTutorRecord } from "./tutor-start.ts";

type Revision = Readonly<{ count: number; last: number | null; hidden: number }>;
async function readRevision(db: D1Database, owner: SiteIdentity): Promise<Revision> {
  const row = await readStorage("dashboard.revision", () => db.prepare("SELECT count(*) AS count,max(rowid) AS last,(SELECT count(*) FROM attempts WHERE owner_id=? AND status='awaiting-answer' AND hidden_material=1) AS hidden FROM atomic_requests WHERE owner_id=?").bind(owner.userId, owner.userId).first<Revision>());
  if (row === null) throw domainFailure("storage_failure", "dashboard.revision-missing", null);
  return row;
}
function requireBounded<T>(rows: readonly T[], operation: string): readonly T[] {
  if (rows.length > 200) throw domainFailure("limit_exceeded", operation, null);
  return rows;
}
async function readSessions(db: D1Database, owner: SiteIdentity): Promise<readonly DashboardSession[]> {
  const rows = await readStorage("dashboard.sessions", () => db.prepare("SELECT t.id,t.version,u.title,c.title AS course,json_extract(t.state,'$.phase') AS phase,CASE WHEN json_type(t.state,'$.review') IS NOT NULL THEN 'review' WHEN json_type(t.state,'$.editor') IS NOT NULL THEN 'editor' ELSE 'tutor' END AS kind FROM tutor_sessions t JOIN sessions s ON s.owner_id=t.owner_id AND s.id=t.id JOIN units u ON u.owner_id=s.owner_id AND u.id=s.unit_id JOIN courses c ON c.owner_id=u.owner_id AND c.id=u.course_id WHERE t.owner_id=? AND json_extract(t.state,'$.phase')!='finished' ORDER BY t.rowid DESC LIMIT 201").bind(owner.userId).all());
  return requireBounded(rows.results, "dashboard.session-limit").map(row => dashboardSession.parse(row));
}
async function readScopes(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, today: string): Promise<readonly DashboardScope[]> {
  const rows = await readStorage("dashboard.scopes", () => db.prepare("SELECT s.id,c.title AS course FROM study_scopes s JOIN units u ON u.owner_id=s.owner_id AND u.id=s.unit_id JOIN courses c ON c.owner_id=u.owner_id AND c.id=u.course_id WHERE s.owner_id=? AND json_extract(s.state,'$.input.date')=? ORDER BY s.rowid DESC LIMIT 201").bind(owner.userId, today).all<{ id: string; course: string }>());
  const result: DashboardScope[] = [];
  for (const row of requireBounded(rows.results, "dashboard.scope-limit")) {
    const state = await getStudyScope(db, owner, row.id);
    let current: boolean = true;
    try { await requireCurrentScope(db, bucket, owner, state); }
    catch (error: unknown) { if (!isDomainFailure(error) || error.code !== "reference_conflict") throw error; current = false; }
    result.push(dashboardScope.parse({ id: state.input.id, version: state.version, title: state.unit.title, course: row.course, date: state.input.date, phase: state.phase, minutes: state.bundle?.plannedMinutes ?? state.input.availableMinutes, current }));
  }
  return result;
}
async function readResults(db: D1Database, owner: SiteIdentity): Promise<readonly DashboardResult[]> {
  const rows = await readStorage("dashboard.results", () => db.prepare("SELECT r.unit_id AS unitId,u.title,c.title AS course,s.session_id AS sessionId FROM learning_results r JOIN units u ON u.owner_id=r.owner_id AND u.id=r.unit_id JOIN courses c ON c.owner_id=u.owner_id AND c.id=u.course_id LEFT JOIN session_confirmations s ON s.owner_id=r.owner_id AND s.result_version_id=r.current_version_id WHERE r.owner_id=? AND r.current_version_id IS NOT NULL ORDER BY r.rowid DESC LIMIT 201").bind(owner.userId).all());
  const result: DashboardResult[] = [];
  for (const raw of requireBounded(rows.results, "dashboard.result-limit")) {
    const row = z.object({ unitId: recordId, title: z.string(), course: z.string(), sessionId: recordId.nullable() }).strict().parse(raw);
    const record = await readCurrentTutorRecord(db, owner, row.unitId);
    if (!record) throw domainFailure("version_conflict", "dashboard.result-changed-refresh", null);
    result.push(dashboardResult.parse({ title: row.title, course: row.course, sessionId: row.sessionId, record }));
  }
  return result;
}
/** 집계는 읽기만 수행하며 저장된 판정·복습 일정·비용을 변경하지 않습니다. */
export async function readLearningDashboard(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, now: number): Promise<LearningDashboard> {
  siteIdentity.parse(owner);
  const today = seoulCalendarDate(instant.parse(new Date(now).toISOString()), "Asia/Seoul");
  const before = await readRevision(db, owner);
  const sessions = await readSessions(db, owner);
  const visible = before.hidden === 0;
  const scopes = visible ? await readScopes(db, bucket, owner, today) : [];
  const overview = visible ? await readReviewOverview(db, owner, instant.parse(new Date(now).toISOString()), "Asia/Seoul") : null;
  const results = visible ? await readResults(db, owner) : [];
  const after = await readRevision(db, owner);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw domainFailure("version_conflict", "dashboard.changed-during-read-refresh", null);
  return learningDashboard.parse({ asOf: now, today, revision: `${after.count}:${after.last ?? 0}`, visibility: visible ? "visible" : "hidden-recall", scopes, sessions: visible ? sessions : sessions.map(session => ({ ...session, title: "진행 중인 학습", course: "" })), reviews: overview ? dashboardReviews(overview.plans) : [], legacyReviews: overview?.legacy.length ?? 0, results });
}
