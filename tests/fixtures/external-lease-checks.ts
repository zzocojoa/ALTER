import { fixtureGoogleConnection } from "./google-connected.ts";
import { createExternalWorkflow } from "../../db/repositories/external-workflow.ts";
import { claimExternalWrite, claimExternalVerification, expireExternalOperationLease, operationLease, readExternalOperation, renewExternalLease, requireExternalLease } from "../../db/repositories/external-operation.ts";
import type { ExternalWorkflowSeed } from "../../lib/external/creation.ts";
import type { ExternalOperationRow } from "../../db/repositories/external-operation.ts";
import { recordId } from "../../lib/domain/contracts.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function rejected(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch (error: unknown) { if (error instanceof Error && "code" in error && ["version_conflict", "reference_conflict", "external_transition_denied"].includes(String(error.code))) return; throw error; }
  throw new Error("만료·경쟁 실행이 허용됐습니다.");
}
export async function checkExternalLeases(db: D1Database): Promise<readonly string[]> {
  const now: number = Date.parse("2026-10-25T02:00:00Z"); const fixture = await fixtureGoogleConnection(db, "external-lease-owner", now);
  const seed: ExternalWorkflowSeed = { jobId: null, kind: "calendar", targetKey: "lease-fixed", sourceVersion: "v1", predecessorId: null, operations: [1, 2].map(index => ({ stepKind: "calendar", kind: "calendar-insert", businessKey: `event-${index}`, requestSnapshot: '{}', expectedSnapshot: '{}', externalId: `event-${index}` })) };
  const job = await createExternalWorkflow(db, fixture.owner, "lease-test", seed, now);
  const rows = await db.prepare("SELECT id FROM external_operations WHERE owner_id=? AND workflow_id=? ORDER BY ordinal").bind(fixture.owner.userId, job.id).all<{ id: string }>();
  const first = recordId.parse(rows.results[0].id); const second = recordId.parse(rows.results[1].id);
  await rejected(() => claimExternalWrite(db, fixture.owner, { operationId: second, expectedVersion: 1, leaseId: recordId.parse(crypto.randomUUID()), attemptId: recordId.parse(crypto.randomUUID()), now, leaseUntil: now + 30_000 }));
  ensure((await db.prepare("SELECT count(*) AS n FROM external_attempt_records WHERE owner_id=?").bind(fixture.owner.userId).first<{ n: number }>())?.n === 0, "UPDATE 0건에도 시도가 생성됨");
  await db.prepare("CREATE TRIGGER external_test_injected BEFORE INSERT ON external_attempt_records WHEN NEW.owner_id='external-lease-owner' BEGIN SELECT RAISE(ABORT,'injected_external_attempt_failure'); END").run();
  await rejected(() => claimExternalWrite(db, fixture.owner, { operationId: first, expectedVersion: 1, leaseId: recordId.parse(crypto.randomUUID()), attemptId: recordId.parse(crypto.randomUUID()), now, leaseUntil: now + 30_000 }));
  await db.prepare("DROP TRIGGER external_test_injected").run();
  ensure((await readExternalOperation(db, fixture.owner, first)).state === "pending", "시도 생성 실패 후 선점이 부분 커밋됨");
  const races = await Promise.allSettled(Array.from({ length: 12 }, () => claimExternalWrite(db, fixture.owner, { operationId: first, expectedVersion: 1, leaseId: recordId.parse(crypto.randomUUID()), attemptId: recordId.parse(crypto.randomUUID()), now, leaseUntil: now + 30_000 })));
  const winners: readonly ExternalOperationRow[] = races.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  ensure(winners.length === 1, "동시 선점 승자가 하나가 아님");
  ensure((await db.prepare("SELECT count(*) AS n FROM external_attempt_records WHERE owner_id=?").bind(fixture.owner.userId).first<{ n: number }>())?.n === 1, "경쟁 실패 시도 부분 생성");
  const original: ExternalOperationRow = winners[0];
  const renewed: ExternalOperationRow = await renewExternalLease(db, fixture.owner, operationLease(original), now + 45_000, now + 10_000);
  await rejected(() => requireExternalLease(db, fixture.owner, operationLease(original), now + 10_001));
  await rejected(() => expireExternalOperationLease(db, fixture.owner, first, renewed.version, now + 44_999));
  const unknown: ExternalOperationRow = await expireExternalOperationLease(db, fixture.owner, first, renewed.version, now + 45_000);
  ensure(unknown.state === "unknown" && unknown.leaseId === null, "만료를 미실행으로 처리");
  await rejected(() => claimExternalWrite(db, fixture.owner, { operationId: first, expectedVersion: unknown.version, leaseId: recordId.parse(crypto.randomUUID()), attemptId: recordId.parse(crypto.randomUUID()), now: now + 45_001, leaseUntil: now + 75_001 }));
  const recovery = await claimExternalVerification(db, fixture.owner, { operationId: first, expectedVersion: unknown.version, leaseId: recordId.parse(crypto.randomUUID()), attemptId: recordId.parse(crypto.randomUUID()), now: now + 45_001, leaseUntil: now + 75_001 });
  ensure(recovery.leaseEpoch === original.leaseEpoch + 1, "재개 실행 버전 증가 누락");
  await rejected(() => requireExternalLease(db, fixture.owner, operationLease(renewed), now + 45_002));
  await rejected(() => renewExternalLease(db, fixture.owner, operationLease(original), now + 80_000, now + 45_002));
  const attempts = await db.prepare("SELECT ordinal,state,mode FROM external_attempt_records WHERE owner_id=? AND operation_id=? ORDER BY ordinal").bind(fixture.owner.userId, first).all<{ ordinal: number; state: string; mode: string }>();
  ensure(attempts.results.length === 2 && attempts.results[0].state === "unknown" && attempts.results[1].state === "started" && attempts.results[1].mode === "verify", "복구 시 과거 이력 유실 또는 재쓰기");
  return ["zero-row-claim-rolls-back-attempt", "mid-batch-failure-rolls-back-lease-and-attempt", "twelve-claims-one-owner-and-one-attempt", "expired-lease-reclaims-verification-only", "stale-version-and-epoch-cannot-renew-or-use-lease", "recovery-preserves-unknown-attempt-history"];
}
