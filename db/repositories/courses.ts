import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import { courses, planVersions, units } from "../schema.ts";
import { recordId, siteIdentity } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

export const courseInput = z.object({ id: recordId, title: z.string().min(1).max(300) }).strict();
export const unitInput = courseInput.extend({ courseId: recordId, ordinal: z.number().int().positive() });
export const planInput = courseInput.extend({ courseId: recordId });
export const planContent = z.object({ objective: z.string().min(1), unitIds: z.array(recordId).min(1), minutesPerWeek: z.number().int().positive().max(10_080) }).strict();
export type CourseInput = z.infer<typeof courseInput>;
export type UnitInput = z.infer<typeof unitInput>;
export type PlanInput = z.infer<typeof planInput>;
export type PlanContent = z.infer<typeof planContent>;
export type Course = typeof courses.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type PlanVersion = typeof planVersions.$inferSelect;

export async function createCourse(db: D1Database, context: Command, value: CourseInput): Promise<Receipt> {
  const input: CourseInput = courseInput.parse(value);
  return executeAtomic(db, context, "course.create", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO courses VALUES (?,?,1,?,?)").bind(context.owner.userId, input.id, requestId, input.title)]);
}
export async function createUnit(db: D1Database, context: Command, value: UnitInput): Promise<Receipt> {
  const input: UnitInput = unitInput.parse(value);
  return executeAtomic(db, context, "unit.create", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO units VALUES (?,?,1,?,?,?,?)").bind(context.owner.userId, input.id, requestId, input.courseId, input.ordinal, input.title)]);
}
export async function createPlan(db: D1Database, context: Command, value: PlanInput): Promise<Receipt> {
  const input: PlanInput = planInput.parse(value);
  return executeAtomic(db, context, "plan.create", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO plans VALUES (?,?,1,?,?,?)").bind(context.owner.userId, input.id, requestId, input.courseId, input.title)]);
}
export async function savePlanDraft(db: D1Database, context: Command, planId: string, content: PlanContent): Promise<Receipt> {
  recordId.parse(planId); const input: PlanContent = planContent.parse(content);
  return executeAtomic(db, context, "plan.draft", input, planId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "plans", context.owner.userId, planId, context.expectedVersion, requestId, 0, "title = title", [], "1", []),
    db.prepare("INSERT INTO plan_drafts VALUES (?,?,1,?,?,?) ON CONFLICT(owner_id,plan_id) DO UPDATE SET content = excluded.content, version = version + 1, last_request_id = excluded.last_request_id").bind(context.owner.userId, planId, requestId, planId, JSON.stringify(input)),
  ]);
}
export async function confirmPlan(db: D1Database, context: Command, planId: string, versionId: string, confirmedAt: number): Promise<Receipt> {
  recordId.parse(planId); recordId.parse(versionId);
  return executeAtomic(db, context, "plan.confirm", { versionId, confirmedAt }, planId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "plans", context.owner.userId, planId, context.expectedVersion, requestId, 0, "title = title", [], "EXISTS(SELECT 1 FROM plan_drafts WHERE owner_id = ? AND plan_id = ?)", [context.owner.userId, planId]),
    db.prepare("INSERT INTO plan_versions (owner_id,id,plan_id,course_id,ordinal,content,confirmed_at) VALUES (?,?,?,(SELECT course_id FROM plans WHERE owner_id = ? AND id = ?),?,(SELECT content FROM plan_drafts WHERE owner_id = ? AND plan_id = ?),?)").bind(context.owner.userId, versionId, planId, context.owner.userId, planId, context.expectedVersion + 1, context.owner.userId, planId, confirmedAt),
  ]);
}
export async function listCourses(db: D1Database, owner: SiteIdentity): Promise<Course[]> {
  siteIdentity.parse(owner); return drizzle(db).select().from(courses).where(eq(courses.ownerId, owner.userId)).orderBy(courses.id);
}
export async function listUnits(db: D1Database, owner: SiteIdentity, courseId: string): Promise<Unit[]> {
  siteIdentity.parse(owner); recordId.parse(courseId); return drizzle(db).select().from(units).where(and(eq(units.ownerId, owner.userId), eq(units.courseId, courseId))).orderBy(units.ordinal);
}
