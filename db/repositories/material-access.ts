import { recordId, timestamp } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { materialFailure } from "../../lib/materials/policy.ts";
import type { StoredTransfer } from "./material-transfers.ts";
import { executeAtomic, guardedUpdate, isDomainFailure, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

type OpenAttempt = Readonly<{ id: string; version: number; hidden_material: number }>;

async function openMaterialAttempts(db: D1Database, owner: SiteIdentity): Promise<readonly OpenAttempt[]> {
  const result = await readStorage("material.visibility", () => db.prepare("SELECT id,version,hidden_material FROM attempts WHERE owner_id=? AND status='awaiting-answer' ORDER BY id LIMIT 2").bind(owner.userId).all<OpenAttempt>());
  if (result.results.some((attempt): boolean => attempt.hidden_material === 1)) throw materialFailure("material_access_required", "material-hidden-during-recall", 403);
  if (result.results.length > 1) throw materialFailure("material_access_required", "multiple-open-learning-attempts", 409);
  return result.results;
}

/** 주소 직접 입력·HEAD도 서버의 미제출 인출 상태를 우회하지 못합니다. */
export async function requireMaterialVisibility(db: D1Database, owner: SiteIdentity): Promise<void> { await openMaterialAttempts(db, owner); }

/** 동일 자료의 여러 Range 요청은 도움 이력을 한 번만 기록하고 그 결과를 재확인합니다. */
export async function recordMaterialExposure(db: D1Database, owner: SiteIdentity, transfer: StoredTransfer): Promise<void> {
  const attempts: readonly OpenAttempt[] = await openMaterialAttempts(db, owner);
  if (attempts.length === 0) return;
  const attempt: OpenAttempt = attempts[0];
  const existing = (): Promise<string | null> => readStorage("material.exposure.previous", () => db.prepare("SELECT id FROM material_exposures WHERE owner_id=? AND attempt_id=? AND material_id=?").bind(owner.userId, attempt.id, transfer.materialId).first<string>("id"));
  if (await existing() !== null) return;
  const id: string = crypto.randomUUID();
  const helpId: string = crypto.randomUUID();
  const now: number = Date.now();
  try {
    await executeAtomic(db, { owner, requestKey: crypto.randomUUID(), expectedVersion: attempt.version }, "material.expose", { materialId: transfer.materialId, attemptId: attempt.id, now }, id, 1, (requestId: string): readonly D1PreparedStatement[] => [
      requireInBatch(db, owner.userId, requestId, 0, "(SELECT COUNT(*) FROM attempts WHERE owner_id=? AND status='awaiting-answer')=1", [owner.userId]),
      ...guardedUpdate(db, "attempts", owner.userId, attempt.id, attempt.version, requestId, 1, "status=status", [], "status='awaiting-answer' AND hidden_material=0", []),
      db.prepare("INSERT INTO help_events VALUES (?,?,?,?,'explanation',3,?)").bind(owner.userId, helpId, attempt.id, attempt.version + 1, now),
      db.prepare("INSERT INTO material_exposures VALUES (?,?,?,?,?,?)").bind(owner.userId, id, transfer.materialId, attempt.id, helpId, now),
    ]);
  } catch (error: unknown) {
    if (!isDomainFailure(error) || !["reference_conflict", "version_conflict"].includes(error.code)) throw error;
    const refreshed: readonly OpenAttempt[] = await openMaterialAttempts(db, owner);
    if (refreshed.length !== 1 || refreshed[0].id !== attempt.id || await existing() === null) throw error;
  }
}

/** 사진 답안 등록은 이미 검증된 같은 과정 파일만 참조하며 원본 객체를 복제하지 않습니다. */
export async function attachAnswerFile(db: D1Database, context: Command, answerId: string, materialId: string, linkedAt: number): Promise<Receipt> {
  recordId.parse(answerId); recordId.parse(materialId); timestamp.parse(linkedAt);
  return executeAtomic(db, context, "answer.file.attach", { answerId, materialId, linkedAt }, answerId, 1, (): readonly D1PreparedStatement[] => [
    db.prepare("INSERT INTO answer_files VALUES (?,?,?,?)").bind(context.owner.userId, answerId, materialId, linkedAt),
  ]);
}
