import { contentHash, recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { createExternalWorkflow } from "../../db/repositories/external-workflow.ts";
import { claimExternalVerification, claimExternalWrite, operationLease, readExternalOperation } from "../../db/repositories/external-operation.ts";
import { recordExternalFailure, recordExternalIntent, recordExternalVerification } from "../../db/repositories/external-progress.ts";
import { externalVerification } from "../../lib/external/verification.ts";
import { classifyExternalFailure } from "../../lib/external/failure.ts";
import { readGoogleExternalContract } from "../../lib/external/google-contract.ts";

/** 합성 학습 기록에 응답 유실·만료 임대를 주입하며 실제 Google 요청은 하지 않습니다. */
export async function seedUncertainRestoreSource(db: D1Database, owner: SiteIdentity, now: number): Promise<void> {
  const doc = await db.prepare("SELECT id,workflow_id FROM external_operations WHERE owner_id=? AND kind='document-write' AND state='confirmed' AND external_id IS NOT NULL LIMIT 1").bind(owner.userId).first<{ id: string; workflow_id: string }>();
  if (doc === null) throw new Error("부분 반영 시험용 문서 완료 기록 없음");
  const row = await db.prepare("SELECT id FROM external_operations WHERE owner_id=? AND workflow_id=? AND kind IN ('report-row-append','report-row-update') AND external_id IS NOT NULL LIMIT 1").bind(owner.userId, doc.workflow_id).first<{ id: string }>();
  if (row === null) throw new Error("부분 반영 시험용 성과표 기록 없음");
  const original = await readExternalOperation(db, owner, doc.id); const expected = readGoogleExternalContract(original).expected;
  if (expected.kind !== "document") throw new Error("시험용 문서 기대값 없음");
  const originalRow = await readExternalOperation(db, owner, row.id); const rowContract = readGoogleExternalContract(originalRow);
  const partial = await createExternalWorkflow(db, owner, "restore-partial-fixture", { jobId: null, kind: "calendar", targetKey: "restore-partial-fixture", sourceVersion: "v1", predecessorId: null, operations: [
    { stepKind: "docs", kind: "document-verify", businessKey: "restore-partial-document", externalId: original.externalId, requestSnapshot: JSON.stringify({ kind: "document-verify", target: { source: "known", externalId: original.externalId } }), expectedSnapshot: JSON.stringify(expected) },
    { stepKind: "sheets", kind: originalRow.kind, businessKey: "restore-partial-row", externalId: originalRow.externalId, requestSnapshot: JSON.stringify(rowContract.request), expectedSnapshot: JSON.stringify(rowContract.expected) },
  ] }, now);
  const operations = (await db.prepare("SELECT id FROM external_operations WHERE owner_id=? AND workflow_id=? ORDER BY ordinal").bind(owner.userId, partial.id).all<{ id: string }>()).results;
  const verifyId = recordId.parse(crypto.randomUUID());
  const docClaim = await claimExternalVerification(db, owner, { operationId: recordId.parse(operations[0].id), expectedVersion: 1, leaseId: recordId.parse(crypto.randomUUID()), attemptId: verifyId, now, leaseUntil: now + 60_000 });
  const connection = await db.prepare("SELECT google_subject,connection_id,generation FROM external_workflows WHERE owner_id=? AND id=?").bind(owner.userId, partial.id).first<{ google_subject: string; connection_id: string; generation: number }>();
  if (connection === null || original.verification === null) throw new Error("합성 문서 대조 근거 없음");
  await db.prepare("INSERT INTO google_requests VALUES (?,?,?,?,?,?,1,? ,?,'succeeded',?,?,?,?,0,200,NULL,NULL)").bind(owner.userId, verifyId, "fixture-project", connection.google_subject, connection.connection_id, connection.generation, "docs.documents.get", await contentHash({ operation: docClaim.id }), now, now + 60_000, now, now).run();
  const proof = externalVerification.parse({ ...JSON.parse(original.verification), checkedAt: now });
  await recordExternalVerification(db, owner, operationLease(docClaim), proof, { id: verifyId, status: 200 }, 0, now);
  const rowClaim = await claimExternalWrite(db, owner, { operationId: recordId.parse(operations[1].id), expectedVersion: 1, leaseId: recordId.parse(crypto.randomUUID()), attemptId: recordId.parse(crypto.randomUUID()), now, leaseUntil: now + 60_000 });
  const rowIntent = await recordExternalIntent(db, owner, operationLease(rowClaim), now);
  await recordExternalFailure(db, owner, operationLease(rowIntent), classifyExternalFailure(new TypeError("합성 성과표 응답 유실"), "write"), 0, now);
  const old: number = now - 120_000;
  const expired = await createExternalWorkflow(db, owner, "restore-expired-fixture", { jobId: null, kind: "calendar", targetKey: "restore-expired-fixture", sourceVersion: "v1", predecessorId: null, operations: [{ stepKind: "docs", kind: "document-write", businessKey: "restore-expired-document", externalId: original.externalId, requestSnapshot: JSON.stringify({ kind: "document-write", target: { source: "known", externalId: original.externalId }, base: expected }), expectedSnapshot: JSON.stringify(expected) }] }, old);
  const operation = await db.prepare("SELECT id FROM external_operations WHERE owner_id=? AND workflow_id=?").bind(owner.userId, expired.id).first<string>("id"); if (operation === null) throw new Error("만료 시험 단계 없음");
  const claimed = await claimExternalWrite(db, owner, { operationId: recordId.parse(operation), expectedVersion: 1, leaseId: recordId.parse(crypto.randomUUID()), attemptId: recordId.parse(crypto.randomUUID()), now: old, leaseUntil: old + 60_000 });
  await recordExternalIntent(db, owner, operationLease(claimed), old + 1);
}
