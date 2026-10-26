import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { confirmedResults, learningResults } from "../schema.ts";
import { performance, progress, recordId, siteIdentity, timestamp } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

const confirmation = z.object({ id: recordId, resultId: recordId, answerId: recordId, progress, performance, confirmedAt: timestamp, correctionId: recordId.nullable() }).strict();
export type Confirmation = z.infer<typeof confirmation>;
export type ConfirmedResult = typeof confirmedResults.$inferSelect;

export async function createLearningResult(db: D1Database, context: Command, id: string, unitId: string): Promise<Receipt> {
  recordId.parse(id); recordId.parse(unitId);
  return executeAtomic(db, context, "result.create", { unitId }, id, 1, (requestId: string) => [db.prepare("INSERT INTO learning_results VALUES (?,?,1,?,?,NULL)").bind(context.owner.userId, id, requestId, unitId)]);
}

/** 확정 버전과 현재 참조를 같은 배치에 저장합니다. */
export async function confirmResult(db: D1Database, context: Command, value: Confirmation): Promise<Receipt> {
  const input: Confirmation = confirmation.parse(value);
  return executeAtomic(db, context, "result.confirm", input, input.resultId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "learning_results", context.owner.userId, input.resultId, context.expectedVersion, requestId, 0, "unit_id = unit_id", [], "1", []),
    db.prepare("INSERT INTO confirmed_results VALUES (?,?,?,?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.resultId, context.expectedVersion + 1, input.answerId, input.progress, input.performance, input.confirmedAt, input.correctionId),
    db.prepare("UPDATE learning_results SET current_version_id = ? WHERE owner_id = ? AND id = ? AND last_request_id = ?").bind(input.id, context.owner.userId, input.resultId, requestId),
  ]);
}

export async function latestConfirmedResult(db: D1Database, owner: SiteIdentity, unitId: string): Promise<ConfirmedResult | null> {
  siteIdentity.parse(owner); recordId.parse(unitId);
  const rows = await drizzle(db).select({ result: confirmedResults }).from(learningResults).innerJoin(confirmedResults, and(eq(confirmedResults.ownerId, learningResults.ownerId), eq(confirmedResults.id, learningResults.currentVersionId))).where(and(eq(learningResults.ownerId, owner.userId), eq(learningResults.unitId, unitId))).limit(1);
  return rows.length === 0 ? null : rows[0].result;
}
