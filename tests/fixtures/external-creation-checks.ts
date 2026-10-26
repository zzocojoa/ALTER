import { fixtureGoogleConnection } from "./google-connected.ts";
import { createExternalWorkflow } from "../../db/repositories/external-workflow.ts";
import type { ExternalWorkflowRow } from "../../db/repositories/external-workflow.ts";
import type { ExternalWorkflowSeed } from "../../lib/external/creation.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function rejected(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch (error: unknown) { if (error instanceof Error && "code" in error && ["external_request_conflict", "external_predecessor_required", "reference_conflict"].includes(String(error.code))) return; throw error; }
  throw new Error("중복 작업의 충돌을 거부하지 않았습니다.");
}
export async function checkExternalCreation(db: D1Database): Promise<readonly string[]> {
  const now: number = Date.parse("2026-10-25T02:00:00Z"); const fixture = await fixtureGoogleConnection(db, "external-creation-owner", now);
  const seed: ExternalWorkflowSeed = { jobId: null, kind: "calendar", targetKey: "fixed-calendar", sourceVersion: "v1", predecessorId: null, operations: [{ stepKind: "calendar", kind: "calendar-insert", businessKey: "event-1", requestSnapshot: '{"b":2,"a":1}', expectedSnapshot: '{"title":"fixed"}', externalId: "fixed-event" }] };
  const same = await Promise.all(Array.from({ length: 10 }, () => createExternalWorkflow(db, fixture.owner, "same-request", seed, now)));
  ensure(new Set(same.map(row => row.id)).size === 1, "동시 동일 요청이 여러 작업 생성");
  const aliases = await Promise.all(Array.from({ length: 10 }, (_, index) => createExternalWorkflow(db, fixture.owner, `alias-${index}`, { ...seed, operations: seed.operations.map(operation => ({ ...operation, requestSnapshot: '{ "a":1, "b":2 }' })) }, now)));
  ensure(aliases.every(row => row.id === same[0].id), "다른 키 또는 JSON 필드 순서가 중복 생성");
  await rejected(() => createExternalWorkflow(db, fixture.owner, "same-request", { ...seed, sourceVersion: "v2" }, now));
  await rejected(() => createExternalWorkflow(db, fixture.owner, "changed", { ...seed, operations: seed.operations.map(operation => ({ ...operation, expectedSnapshot: '{"title":"different"}' })) }, now));
  const first: ExternalWorkflowRow = same[0];
  await db.prepare("UPDATE external_workflows SET state='unknown' WHERE owner_id=? AND id=?").bind(fixture.owner.userId, first.id).run();
  ensure((await createExternalWorkflow(db, fixture.owner, "unknown-replay", seed, now)).id === first.id, "미확정 상태를 새 키로 우회");
  await rejected(() => createExternalWorkflow(db, fixture.owner, "new-version-blocked", { ...seed, sourceVersion: "v2", predecessorId: first.id }, now));
  await rejected(() => createExternalWorkflow(db, fixture.owner, "new-version-no-parent", { ...seed, sourceVersion: "v2" }, now));
  const operation = await db.prepare("SELECT id,expected_hash FROM external_operations WHERE owner_id=? AND workflow_id=?").bind(fixture.owner.userId, first.id).first<{ id: string; expected_hash: string }>();
  if (!operation) throw new Error("생성한 외부 단계 없음");
  await db.prepare("UPDATE external_operations SET state='running',lease_id=?,lease_epoch=1,lease_until=?,attempt_count=1 WHERE owner_id=? AND id=?").bind(crypto.randomUUID(), now + 30_000, fixture.owner.userId, operation.id).run();
  await db.prepare("UPDATE external_operations SET state='confirmed',lease_id=NULL,lease_until=NULL,verification=? WHERE owner_id=? AND id=?").bind(JSON.stringify({status:"matched",expectedHash:operation.expected_hash,checkedAt:now}), fixture.owner.userId, operation.id).run();
  await db.prepare("UPDATE external_workflows SET state='confirmed' WHERE owner_id=? AND id=?").bind(fixture.owner.userId, first.id).run();
  await rejected(() => createExternalWorkflow(db, fixture.owner, "new-target-forbidden", { ...seed, sourceVersion: "v2", predecessorId: first.id, operations: seed.operations.map(item => ({ ...item, externalId: null })) }, now));
  const next = await createExternalWorkflow(db, fixture.owner, "new-version", { ...seed, sourceVersion: "v2", predecessorId: first.id }, now + 1);
  ensure(next.id !== first.id, "새 확정 버전 구분 실패");
  await rejected(() => createExternalWorkflow(db, fixture.owner, "fork-forbidden", { ...seed, sourceVersion: "v3", predecessorId: first.id }, now + 2));
  const count = await db.prepare("SELECT count(*) AS n FROM external_workflows WHERE owner_id=?").bind(fixture.owner.userId).first<{ n: number }>();
  ensure(count?.n === 2, "실패한 생성이 일부 커밋됨");
  return ["ten-concurrent-identical-requests-one-workflow", "different-keys-and-normalized-json-converge", "key-and-business-version-content-conflicts-rejected", "unknown-write-blocks-new-version-and-key-bypass", "new-version-retains-confirmed-target-and-single-successor"];
}
