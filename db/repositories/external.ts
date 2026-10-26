import { z } from "zod";
import { recordId, timestamp, version, domainFailure } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt, SqlValue } from "./atomic.ts";

const jobInput = z.object({ id: recordId, weeklyVersionId: recordId.nullable(), businessKey: z.string().min(1), kind: z.enum(["weekly-export", "calendar", "ai"]), steps: z.array(z.object({ id: recordId, kind: z.string().min(1) }).strict()).min(1).max(20) }).strict();
const stepClaim = z.object({ stepId: recordId, attemptId: recordId, ordinal: version, now: timestamp, leaseUntil: timestamp }).strict().refine((value) => value.leaseUntil > value.now);
const stepEvidence = z.object({ stepId: recordId, externalId: z.string().min(1), businessKey: z.string().min(1), evidence: z.string().min(1), checkedAt: timestamp }).strict();
export type JobInput = z.infer<typeof jobInput>;
export type StepClaim = z.infer<typeof stepClaim>;
export type StepEvidence = z.infer<typeof stepEvidence>;
type JobVersion = Readonly<{ id: string; version: number }>;
async function jobVersion(db: D1Database, context: Command, stepId: string): Promise<JobVersion> {
  const job: JobVersion | null = await readStorage("external.job", () => db.prepare("SELECT j.id,j.version FROM external_jobs j JOIN external_steps s ON s.owner_id = j.owner_id AND s.job_id = j.id WHERE s.owner_id = ? AND s.id = ?").bind(context.owner.userId, stepId).first<JobVersion>());
  if (job === null) throw domainFailure("reference_conflict", "external.job", null);
  return job;
}
function refreshJob(db: D1Database, context: Command, job: JobVersion, requestId: string): readonly D1PreparedStatement[] {
  return guardedUpdate(db, "external_jobs", context.owner.userId, job.id, job.version, requestId, 1, "state = CASE WHEN EXISTS(SELECT 1 FROM external_steps s WHERE s.owner_id = external_jobs.owner_id AND s.job_id = external_jobs.id AND s.state = 'conflict') THEN 'conflict' WHEN NOT EXISTS(SELECT 1 FROM external_steps s WHERE s.owner_id = external_jobs.owner_id AND s.job_id = external_jobs.id AND s.state != 'confirmed') THEN 'complete' WHEN EXISTS(SELECT 1 FROM external_steps s WHERE s.owner_id = external_jobs.owner_id AND s.job_id = external_jobs.id AND s.state = 'confirmed') THEN 'partial' ELSE 'running' END", [], "1", []);
}
async function updateStep(db: D1Database, context: Command, operation: string, stepId: string, payload: unknown, assignments: string, values: readonly SqlValue[], condition: string, conditions: readonly SqlValue[]): Promise<Receipt> {
  const job: JobVersion = await jobVersion(db, context, stepId);
  return executeAtomic(db, context, operation, payload, stepId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "external_steps", context.owner.userId, stepId, context.expectedVersion, requestId, 0, assignments, values, condition, conditions),
    ...refreshJob(db, context, job, requestId),
    db.prepare("UPDATE external_attempts SET outcome = (SELECT state FROM external_steps WHERE owner_id = ? AND id = ?), finished_at = ?, evidence = json_object('requestId', ?, 'evidence', (SELECT evidence FROM external_steps WHERE owner_id = ? AND id = ?)) WHERE owner_id = ? AND step_id = ? AND outcome IN ('sent','unknown')").bind(context.owner.userId, stepId, Date.now(), requestId, context.owner.userId, stepId, context.owner.userId, stepId),
    requireInBatch(db, context.owner.userId, requestId, 2, "(SELECT count(*) FROM external_attempts WHERE owner_id = ? AND step_id = ? AND json_extract(evidence,'$.requestId') = ?) = 1", [context.owner.userId, stepId, requestId]),
  ]);
}

export async function enqueueExternalJob(db: D1Database, context: Command, value: JobInput): Promise<Receipt> {
  const input: JobInput = jobInput.parse(value);
  return executeAtomic(db, context, "external.enqueue", input, input.id, 1, (requestId: string) => externalJobStatements(db,context,input,requestId));
}
/** 리스 만료와 무관하게 pending만 가져옵니다. unknown은 별도 증거 확인이 필요합니다. */
export async function claimExternalStep(db: D1Database, context: Command, value: StepClaim): Promise<Receipt> {
  const input: StepClaim = stepClaim.parse(value);
  const job: JobVersion = await jobVersion(db, context, input.stepId);
  return executeAtomic(db, context, "external.claim", input, input.stepId, context.expectedVersion + 1, (requestId: string) => [
    ...guardedUpdate(db, "external_steps", context.owner.userId, input.stepId, context.expectedVersion, requestId, 0, "state = 'leased', lease_until = ?", [input.leaseUntil], "state = 'pending' AND NOT EXISTS(SELECT 1 FROM external_steps prior WHERE prior.owner_id = external_steps.owner_id AND prior.job_id = external_steps.job_id AND prior.ordinal < external_steps.ordinal AND prior.state != 'confirmed')", []),
    db.prepare("INSERT INTO external_attempts VALUES (?,?,?,?,?,NULL,'sent',NULL)").bind(context.owner.userId, input.attemptId, input.stepId, input.ordinal, input.now),
    ...refreshJob(db, context, job, requestId),
  ]);
}
export async function markExternalUnknown(db: D1Database, context: Command, stepId: string, evidence: string): Promise<Receipt> {
  recordId.parse(stepId); z.string().min(1).parse(evidence);
  return updateStep(db, context, "external.unknown", stepId, { evidence }, "state = 'unknown', evidence = ?", [evidence], "state = 'leased'", []);
}
export async function expireExternalLease(db: D1Database, context: Command, stepId: string, now: number): Promise<Receipt> {
  recordId.parse(stepId); timestamp.parse(now);
  return updateStep(db, context, "external.lease.expire", stepId, { now }, "state = 'unknown', evidence = 'lease-expired-outcome-unknown'", [], "state = 'leased' AND lease_until <= ?", [now]);
}
export async function confirmExternalStep(db: D1Database, context: Command, value: StepEvidence): Promise<Receipt> {
  const input: StepEvidence = stepEvidence.parse(value);
  return updateStep(db, context, "external.confirm", input.stepId, input, "state = 'confirmed', external_id = ?, evidence = ?", [input.externalId, JSON.stringify({ evidence: input.evidence, checkedAt: input.checkedAt })], "state IN ('leased','unknown') AND (external_id IS NULL OR external_id = ?) AND EXISTS(SELECT 1 FROM external_jobs j WHERE j.owner_id = external_steps.owner_id AND j.id = external_steps.job_id AND j.business_key = ?)", [input.externalId, input.businessKey]);
}
export async function recordExternalConflict(db: D1Database, context: Command, stepId: string, evidence: string): Promise<Receipt> {
  recordId.parse(stepId); z.string().min(1).parse(evidence);
  return updateStep(db, context, "external.conflict", stepId, { evidence }, "state = 'conflict', evidence = ?", [evidence], "state IN ('leased','unknown')", []);
}

/** 다른 업무의 확정과 같은 원자적 배치에 내보내기 요청을 연결합니다. */
export function externalJobStatements(db:D1Database,context:Command,value:JobInput,requestId:string):readonly D1PreparedStatement[] {
  const input=jobInput.parse(value);
  return [db.prepare("INSERT INTO external_jobs VALUES (?,?,1,?,?,?,?,'pending')").bind(context.owner.userId,input.id,requestId,input.weeklyVersionId,input.businessKey,input.kind),...input.steps.map((step,index)=>db.prepare("INSERT INTO external_steps VALUES (?,?,1,?,?,?,?,'pending',0,NULL,NULL)").bind(context.owner.userId,step.id,requestId,input.id,index+1,step.kind))];
}
