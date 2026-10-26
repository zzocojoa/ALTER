import { recordId, seoulStudyDate, siteIdentity, studyDate, domainFailure } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { correctedReview, currentLearningRecord, dueReview, startContextIssues, tutorStartContext } from "../../lib/tutor/start.ts";
import type { CorrectedReview, CurrentLearningRecord, DueReview, TutorStartContext } from "../../lib/tutor/start.ts";
import { getStudyScope, readTutorBundle } from "./study-scopes.ts";
import { readStorage } from "./atomic.ts";

export async function readCurrentTutorRecord(db: D1Database, owner: SiteIdentity, unitId: string): Promise<CurrentLearningRecord | null> {
  siteIdentity.parse(owner); recordId.parse(unitId);
  const row = await readStorage("tutor.latest-record", () => db.prepare("SELECT c.id AS resultVersionId,r.unit_id AS unitId,c.progress,c.performance,c.correction_id AS correctionId,n.next_action AS nextAction FROM learning_results r LEFT JOIN confirmed_results c ON c.owner_id=r.owner_id AND c.id=r.current_version_id LEFT JOIN result_next_actions n ON n.owner_id=c.owner_id AND n.result_version_id=c.id WHERE r.owner_id=? AND r.unit_id=? AND r.current_version_id IS NOT NULL").bind(owner.userId,unitId).first());
  return row === null ? null : currentLearningRecord.parse(row);
}
export async function readCorrectedTutorReviews(db: D1Database, owner: SiteIdentity, courseId: string): Promise<readonly CorrectedReview[]> {
  siteIdentity.parse(owner); recordId.parse(courseId);
  const rows = await readStorage("tutor.corrected-reviews", () => db.prepare("SELECT r.id,e.unit_id AS unitId,r.version,r.source_ref_id AS sourceRefId,r.correction_id AS correctionId,r.recheck_state AS recheckState,r.question,r.next_action AS nextAction FROM review_items r JOIN errors e ON e.owner_id=r.owner_id AND e.id=r.error_id JOIN units u ON u.owner_id=e.owner_id AND u.id=e.unit_id WHERE r.owner_id=? AND u.course_id=? ORDER BY r.id LIMIT 201").bind(owner.userId,courseId).all());
  if (rows.results.length>200) throw domainFailure("limit_exceeded","tutor.review-list-requires-narrowing",null);
  return rows.results.map((row): CorrectedReview => correctedReview.parse(row));
}
export async function readDueTutorReviews(db: D1Database, owner: SiteIdentity, courseId: string, date: string): Promise<readonly DueReview[]> {
  siteIdentity.parse(owner); recordId.parse(courseId); studyDate.parse(date);
  const rows = await readStorage("tutor.due-reviews", () => db.prepare("SELECT r.review_id AS id,r.question_id AS questionId,r.due_date AS dueDate,r.basis_result_version_id AS basisResultVersionId,lr.current_version_id AS currentResultVersionId,r.review_version AS reviewVersion,r.correction_id AS correctionId,r.kind FROM review_schedule r JOIN review_items i ON i.owner_id=r.owner_id AND i.id=r.review_id JOIN errors e ON e.owner_id=i.owner_id AND e.id=i.error_id JOIN units u ON u.owner_id=e.owner_id AND u.id=e.unit_id LEFT JOIN learning_results lr ON lr.owner_id=e.owner_id AND lr.unit_id=e.unit_id WHERE r.owner_id=? AND u.course_id=? AND r.state='pending' AND (NOT EXISTS(SELECT 1 FROM review_plans p WHERE p.owner_id=r.owner_id AND p.id=r.review_id) OR EXISTS(SELECT 1 FROM review_plans p WHERE p.owner_id=r.owner_id AND p.id=r.review_id AND p.current_proposal_id=r.id)) AND r.due_date<=? ORDER BY r.due_date,r.id LIMIT 201").bind(owner.userId,courseId,date).all());
  if (rows.results.length>200) throw domainFailure("limit_exceeded","tutor.due-list-requires-narrowing",null);
  return rows.results.map((row): DueReview => dueReview.parse(row));
}
export async function readTutorStart(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, scopeId: string, now: number): Promise<TutorStartContext> {
  const bundle = await readTutorBundle(db,bucket,owner,scopeId); const scope = await getStudyScope(db,owner,scopeId); const today: string = seoulStudyDate(now);
  const [latest,reviews,due] = await Promise.all([readCurrentTutorRecord(db,owner,bundle.unit.unitId),readCorrectedTutorReviews(db,owner,bundle.unit.courseId),readDueTutorReviews(db,owner,bundle.unit.courseId,today)]);
  return tutorStartContext.parse({ scopeId,scopeVersion: scope.version,bundle,today,latest,reviews,due,issues: startContextIssues(latest,reviews,due) });
}
