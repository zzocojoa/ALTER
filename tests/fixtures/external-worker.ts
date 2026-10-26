import { checkExternalDiagnostics } from "./external-diagnostic-checks.ts";
import { checkExternalGoogle } from "./external-google-checks.ts";
import { checkExternalResume } from "./external-resume-checks.ts";
import { checkExternalRecovery } from "./external-recovery-checks.ts";
import { checkExternalRetry } from "./external-retry-checks.ts";
import { checkExternalExecution } from "./external-execution-checks.ts";
import { checkExternalLeases } from "./external-lease-checks.ts";
import { checkExternalCreation } from "./external-creation-checks.ts";
import { fixtureGoogleConnection } from "./google-connected.ts";
import { command, contentHash, recordId } from "../../lib/domain/contracts.ts";
import { enqueueExternalJob } from "../../db/repositories/external.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function rejects(run: () => Promise<unknown>, expected: RegExp): Promise<void> {
  try { await run(); } catch (error: unknown) { if (error instanceof Error && expected.test(error.message)) return; throw error; }
  throw new Error("거부해야 하는 외부 상태 변경이 성공했습니다.");
}
const externalWorker: Readonly<{ fetch: (request: Request, env: Readonly<{ DB: D1Database }>) => Promise<Response> }> = {
  async fetch(_request: Request, env: Readonly<{ DB: D1Database }>): Promise<Response> {
    const db: D1Database = env.DB; const now: number = Date.parse("2026-10-25T02:00:00Z");
    const fixture = await fixtureGoogleConnection(db, "external-state-owner", now);
    const jobId = recordId.parse(crypto.randomUUID()); const stepId = recordId.parse(crypto.randomUUID()); const operationId = recordId.parse(crypto.randomUUID()); const leaseId = recordId.parse(crypto.randomUUID());
    const hash: string = await contentHash({ fixed: "external-state" }); const ownerId: string = fixture.owner.userId;
    await enqueueExternalJob(db, command.parse({ owner: fixture.owner, expectedVersion: 1, requestKey: "external-state" }), { id: jobId, weeklyVersionId: null, businessKey: "external-state", kind: "calendar", steps: [{ id: stepId, kind: "calendar" }] });
    await db.prepare("INSERT INTO external_workflows VALUES (?,?,1,?,'calendar','fixed','v1',?,'{}',?,?,1,'pending',?,?)").bind(ownerId, jobId, crypto.randomUUID(), hash, fixture.connection.connectionId, fixture.connection.googleSubject, now, now + 3600_000).run();
    const insertOperation = (parent: string, id: string): Promise<unknown> => db.prepare("INSERT INTO external_operations VALUES (?,?,1,?,?,?,?, 'calendar-insert','fixed','{}',?,?,NULL,'pending',NULL,0,NULL,NULL,NULL,0,0,NULL,NULL)").bind(ownerId, id, crypto.randomUUID(), jobId, parent, 1, hash, hash).run();
    await rejects(() => insertOperation(crypto.randomUUID(), crypto.randomUUID()), /external_operation_wrong_parent/);
    await insertOperation(stepId, operationId);
    await rejects(() => db.prepare("UPDATE external_operations SET state='confirmed' WHERE owner_id=? AND id=?").bind(ownerId, operationId).run(), /external_operation_transition/);
    await db.prepare("UPDATE external_operations SET state='running',lease_id=?,lease_epoch=1,lease_until=?,attempt_count=1,intent_at=? WHERE owner_id=? AND id=?").bind(leaseId, now + 30_000, now, ownerId, operationId).run();
    const attemptId: string = crypto.randomUUID();
    await db.prepare("INSERT INTO external_attempt_records VALUES (?,?,?,1,?,1,'write','started',?,NULL,NULL,NULL,NULL,NULL)").bind(ownerId, attemptId, operationId, leaseId, now).run();
    await db.prepare("UPDATE external_operations SET state='received',response_at=?,external_id='fixed-event',lease_id=NULL,lease_until=NULL WHERE owner_id=? AND id=?").bind(now + 1, ownerId, operationId).run();
    await rejects(() => db.prepare("UPDATE external_workflows SET state='confirmed' WHERE owner_id=? AND id=?").bind(ownerId, jobId).run(), /external_workflow_unverified/);
    await db.prepare("UPDATE external_attempt_records SET state='received',finished_at=? WHERE owner_id=? AND id=?").bind(now + 1, ownerId, attemptId).run();
    await rejects(() => db.prepare("UPDATE external_attempt_records SET state='verified',verification='{}' WHERE owner_id=? AND id=?").bind(ownerId, attemptId).run(), /external_attempt_finished_immutable/);
    await rejects(() => db.prepare("DELETE FROM external_attempt_records WHERE owner_id=? AND id=?").bind(ownerId, attemptId).run(), /external_attempt_history_required/);
    await db.prepare("UPDATE external_operations SET state='running',lease_id=?,lease_epoch=2,lease_until=?,attempt_count=2 WHERE owner_id=? AND id=?").bind(crypto.randomUUID(), now + 60_000, ownerId, operationId).run();
    await rejects(() => db.prepare("UPDATE external_operations SET state='confirmed',lease_id=NULL,lease_until=NULL,verification=? WHERE owner_id=? AND id=?").bind(JSON.stringify({status:"matched",expectedHash:"wrong",checkedAt:now+2}), ownerId, operationId).run(), /external_operation_evidence/);
    const proof: string = JSON.stringify({status:"matched",expectedHash:hash,checkedAt:now+2});
    await db.prepare("UPDATE external_operations SET state='confirmed',lease_id=NULL,lease_until=NULL,verification=? WHERE owner_id=? AND id=?").bind(proof, ownerId, operationId).run();
    await db.prepare("UPDATE external_workflows SET state='confirmed' WHERE owner_id=? AND id=?").bind(ownerId, jobId).run();
    await rejects(() => db.prepare("UPDATE external_operations SET snapshot='{}' WHERE owner_id=? AND id=?").bind(ownerId, operationId).run(), /external_operation_snapshot_immutable/);
    ensure((await db.prepare("SELECT state FROM external_workflows WHERE owner_id=? AND id=?").bind(ownerId, jobId).first<{state:string}>())?.state === "confirmed", "확인 완료 집계 실패");
    return Response.json({ status: "passed", environment: "local-workerd-d1", checks: ["operation-parent-reference-protected", "response-only-cannot-confirm-workflow", "finished-attempt-history-preserved", "verification-hash-required-for-confirmation", "immutable-request-snapshot", ...await checkExternalCreation(db), ...await checkExternalLeases(db), ...await checkExternalExecution(db), ...await checkExternalRetry(db), ...await checkExternalRecovery(db), ...await checkExternalResume(db), ...await checkExternalGoogle(db), ...await checkExternalDiagnostics(db)] });
  },
};
export default externalWorker;
