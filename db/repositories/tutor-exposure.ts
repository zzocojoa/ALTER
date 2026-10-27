import { domainFailure, recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { tutorExposureCounts } from "../../lib/tutor/exposure.ts";
import type { TutorExposureCounts } from "../../lib/tutor/exposure.ts";
import { readStorage } from "./atomic.ts";

/** 원문 내용 없이 동일 소유자·회차의 저장된 원본 노출 수만 읽습니다. */
export async function readTutorExposureCounts(db: D1Database, owner: SiteIdentity, sessionId: string, questionId: string): Promise<TutorExposureCounts> {
  recordId.parse(sessionId); recordId.parse(questionId);
  const row = await readStorage("tutor.exposure-counts", () => db.prepare("SELECT (SELECT COUNT(*) FROM material_exposures m JOIN attempts a ON a.owner_id=m.owner_id AND a.id=m.attempt_id WHERE a.owner_id=s.owner_id AND a.session_id=s.id) AS sessionCount, (SELECT COUNT(*) FROM material_exposures m JOIN attempts a ON a.owner_id=m.owner_id AND a.id=m.attempt_id WHERE a.owner_id=s.owner_id AND a.session_id=s.id AND a.question_id=?) AS currentQuestionCount FROM sessions s WHERE s.owner_id=? AND s.id=?").bind(questionId, owner.userId, sessionId).first<TutorExposureCounts>());
  if (!row) throw domainFailure("reference_conflict", "tutor.exposure-session-owner", null);
  return tutorExposureCounts.parse(row);
}
