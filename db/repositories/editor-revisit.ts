import { domainFailure, seoulStudyDate } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { initialEditor } from "../../lib/editor/state.ts";
import { requireCurrentTutor } from "../../lib/tutor/current.ts";
import { startContextIssues, tutorStartContext } from "../../lib/tutor/start.ts";
import { executeAtomic, readAtomicReceipt, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { getTutor, tutorCreationStatements } from "./tutor.ts";
import { readCurrentTutorRecord, readCorrectedTutorReviews, readDueTutorReviews } from "./tutor-start.ts";

export type EditorRevisitInput = Readonly<{ id: string; originalId: string; originalVersion: number; questionId: string; attemptId: string }>;
/** 종료한 첨삭의 과제를 새 회차에서 다시 쓰며 과거 답안과 공식 수행 기록은 변경하지 않습니다. */
export async function createEditorRevisit(db: D1Database, bucket: R2Bucket, cmd: Command, input: EditorRevisitInput, now: number): Promise<Receipt> {
  if (cmd.expectedVersion !== 1 || input.id === input.originalId) throw domainFailure("version_conflict", "editor.revisit-new-session-required", null);
  const replay = await readAtomicReceipt(db, cmd, "editor.revisit", input, input.id); if (replay) return replay;
  const original = await getTutor(db, cmd.owner, input.originalId);
  if (!original.editor || original.phase !== "finished" || original.pending || original.version !== input.originalVersion) throw domainFailure("version_conflict", "editor.revisit-finished-version-required", null);
  const unit = original.start.bundle.unit; const today = seoulStudyDate(now);
  const [latest, reviews, due] = await Promise.all([readCurrentTutorRecord(db, cmd.owner, unit.unitId), readCorrectedTutorReviews(db, cmd.owner, unit.courseId), readDueTutorReviews(db, cmd.owner, unit.courseId, today)]);
  const start = tutorStartContext.parse({ ...original.start, today, latest, reviews, due, issues: startContextIssues(latest, reviews, due) });
  const state = initialEditor(input.id, start, input.questionId, input.attemptId);
  await requireCurrentTutor(db, bucket, cmd.owner, state);
  return executeAtomic(db, cmd, "editor.revisit", input, state.id, 1, (requestId) => [
    requireInBatch(db, cmd.owner.userId, requestId, 501, "EXISTS(SELECT 1 FROM tutor_sessions WHERE owner_id=? AND id=? AND version=? AND json_extract(state,'$.phase')='finished')", [cmd.owner.userId, input.originalId, input.originalVersion]),
    ...tutorCreationStatements(db, cmd, state, requestId, input),
  ]);
}
