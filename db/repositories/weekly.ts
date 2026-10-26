import { z } from "zod";
import { domainFailure, recordId, siteIdentity, studyDate, timestamp } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate, readStorage } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

export const weeklyContent = z.object({ achievements: z.string().min(1), difficulties: z.string().min(1), improvements: z.string().min(1), nextActions: z.string().min(1) }).strict();
const weeklyInput = z.object({ id: recordId, courseId: recordId, periodStart: studyDate, periodEnd: studyDate }).strict().refine((value) => value.periodStart <= value.periodEnd);
const weeklyConfirmation = z.object({ id: recordId, summaryId: recordId, planVersionId: recordId, confirmedAt: timestamp, evidence: z.array(z.object({ resultVersionId: recordId, correctionId: recordId.nullable() }).strict()).min(1) }).strict();
export type WeeklyContent = z.infer<typeof weeklyContent>;
export type WeeklyInput = z.infer<typeof weeklyInput>;
export type WeeklyConfirmation = z.infer<typeof weeklyConfirmation>;
export type WeeklyExport = WeeklyContent & Readonly<{ id: string; ordinal: number; periodStart: string; periodEnd: string }>;

export async function createWeeklySummary(db: D1Database, context: Command, value: WeeklyInput): Promise<Receipt> {
  const input: WeeklyInput = weeklyInput.parse(value);
  return executeAtomic(db, context, "weekly.create", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO weekly_summaries VALUES (?,?,1,?,?,?,?)").bind(context.owner.userId, input.id, requestId, input.periodStart, input.periodEnd, input.courseId)]);
}
export async function saveWeeklyDraft(db: D1Database, context: Command, summaryId: string, value: WeeklyContent): Promise<Receipt> {
  recordId.parse(summaryId); const input: WeeklyContent = weeklyContent.parse(value);
  return executeAtomic(db, context, "weekly.draft", input, summaryId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "weekly_summaries", context.owner.userId, summaryId, context.expectedVersion, requestId, 0, "period_start = period_start", [], "1", []),
    db.prepare("INSERT INTO weekly_drafts VALUES (?,?,1,?,?,?) ON CONFLICT(owner_id,summary_id) DO UPDATE SET content = excluded.content, version = version + 1, last_request_id = excluded.last_request_id").bind(context.owner.userId, summaryId, requestId, summaryId, JSON.stringify(input)),
  ]);
}
export async function confirmWeeklySummary(db: D1Database, context: Command, value: WeeklyConfirmation): Promise<Receipt> {
  const input: WeeklyConfirmation = weeklyConfirmation.parse(value);
  return executeAtomic(db, context, "weekly.confirm", input, input.summaryId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "weekly_summaries", context.owner.userId, input.summaryId, context.expectedVersion, requestId, 0, "period_start = period_start", [], "EXISTS(SELECT 1 FROM weekly_drafts WHERE owner_id = ? AND summary_id = ?)", [context.owner.userId, input.summaryId]),
    db.prepare("INSERT INTO weekly_versions VALUES (?,?,?,?,?,(SELECT json_extract(content,'$.achievements') FROM weekly_drafts WHERE owner_id = ? AND summary_id = ?),(SELECT json_extract(content,'$.difficulties') FROM weekly_drafts WHERE owner_id = ? AND summary_id = ?),(SELECT json_extract(content,'$.improvements') FROM weekly_drafts WHERE owner_id = ? AND summary_id = ?),(SELECT json_extract(content,'$.nextActions') FROM weekly_drafts WHERE owner_id = ? AND summary_id = ?),?)").bind(context.owner.userId, input.id, input.summaryId, context.expectedVersion + 1, input.planVersionId, context.owner.userId, input.summaryId, context.owner.userId, input.summaryId, context.owner.userId, input.summaryId, context.owner.userId, input.summaryId, input.confirmedAt),
    ...input.evidence.map((item) => db.prepare("INSERT INTO weekly_evidence VALUES (?,?,?,?,?)").bind(context.owner.userId, crypto.randomUUID(), input.id, item.resultVersionId, item.correctionId)),
  ]);
}
/** 외부 내보내기는 확정 요약의 허용 필드만 반환하며 대화·답안·토큰을 포함하지 않습니다. */
export async function exportWeeklySummary(db: D1Database, owner: SiteIdentity, versionId: string): Promise<WeeklyExport> {
  siteIdentity.parse(owner); recordId.parse(versionId);
  const result: WeeklyExport | null = await readStorage("weekly.export", () => db.prepare("SELECT v.id,v.ordinal,s.period_start AS periodStart,s.period_end AS periodEnd,v.achievements,v.difficulties,v.improvements,v.next_actions AS nextActions FROM weekly_versions v JOIN weekly_summaries s ON s.owner_id = v.owner_id AND s.id = v.summary_id WHERE v.owner_id = ? AND v.id = ?").bind(owner.userId, versionId).first<WeeklyExport>());
  if (result === null) throw domainFailure("reference_conflict", "weekly.export", null);
  return result;
}
