import { command, recordId } from "../domain/contracts.ts";
import type { Command, SiteIdentity } from "../domain/contracts.ts";
import { createCourse } from "../../db/repositories/courses.ts";
import { advanceMaterialTransfer, getMaterialTransfer, getMaterialUsage, initializeMaterialInventory, reserveMaterialTransfer } from "../../db/repositories/material-transfers.ts";
import type { StoredTransfer, TransferReservation } from "../../db/repositories/material-transfers.ts";
import type { AtomicDatabase } from "../../db/repositories/atomic.ts";
import { executeAtomic, guardedUpdate, isDomainFailure } from "../../db/repositories/atomic.ts";
import { materialPolicy } from "./policy.ts";
import type { MaterialMetadata, MaterialRuntimeEvidence } from "./policy.ts";
import type { TransferEvent } from "./transfer-state.ts";

export type MaterialStateAcceptance = Readonly<{ status: "passed"; environment: "local-workerd" | "hosted-d1"; schema: "0011_material_transfer_invariants"; runId: string; startedAt: string; completedAt: string; checks: readonly string[]; cleanup: "passed"; realR2Writes: 0 }>;
const cleanupTables = ["material_files", "material_transfers", "material_inventory", "uploads", "materials", "courses", "atomic_checks", "atomic_requests"] as const;
function ensure(value: boolean, label: string): void { if (!value) throw new Error(`자료 상태 검사 실패: ${label}`); }
async function reject(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await action(); } catch (error: unknown) {
    const message: string = isDomainFailure(error) ? error.code : error instanceof Error ? error.message : String(error);
    ensure(pattern.test(message), `예상 거부 ${pattern.source}, 실제 ${message}`); return;
  }
  throw new Error(`자료 상태 검사 실패: 거부되지 않음 ${pattern.source}`);
}

/** 서버가 만든 검사 범위에서 DB 계약만 검사합니다. 합성 R2 관측을 실제 파일 성공으로 보고하지 않습니다. */
export async function runMaterialStateAcceptance(db: D1Database, environment: "local-workerd" | "hosted-d1"): Promise<MaterialStateAcceptance> {
  const runId: string = crypto.randomUUID();
  const owner: SiteIdentity = { realm: "sites", userId: `verification:${runId}` };
  const startedAt: string = new Date().toISOString();
  const now: number = Date.now();
  const checks: string[] = [];
  const ctx = (version: number): Command => command.parse({ owner, requestKey: crypto.randomUUID(), expectedVersion: version });
  const courseId = recordId.parse(crypto.randomUUID());
  const metadata: MaterialMetadata = { title: "상태 검사 자료", edition: "1판", role: "reference", kind: "text", filename: "검사.txt", mime: "text/plain", bytes: 10, sha256: "a".repeat(64) };
  const reservation = (bytes: number): TransferReservation => ({ id: recordId.parse(crypto.randomUUID()), materialId: recordId.parse(crypto.randomUUID()), uploadId: recordId.parse(crypto.randomUUID()), courseId, metadata: { ...metadata, bytes }, now });
  const step = async (id: string, event: TransferEvent): Promise<void> => { const current: StoredTransfer = await getMaterialTransfer(db, owner, id); await advanceMaterialTransfer(db, ctx(current.version), id, event, now); };
  const discard = async (id: string): Promise<void> => { await step(id, { type: "cleanup" }); await step(id, { type: "deleted" }); };
  const count = (table: string): Promise<number | null> => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id=?`).bind(owner.userId).first<number>("n");
  await db.prepare("INSERT INTO verification_runs VALUES (?,?,'running',?)").bind(owner.userId, runId, now).run();
  let failure: unknown = null;
  try {
    await createCourse(db, ctx(1), { id: courseId, title: "자료 상태 검사" });
    await reject(() => reserveMaterialTransfer(db, ctx(1), reservation(10)), /version_conflict/);
    ensure(await count("materials") === 0, "검증되지 않은 용량에서 생성 차단"); checks.push("unverified-storage-blocks-reservation");
    const evidence: MaterialRuntimeEvidence = { policyVersion: materialPolicy.version, deploymentId: "synthetic-state-fixture", checkedAt: now, validUntil: now + 3600000, acceptedBodyBytes: 20971520, maximumBufferedBytes: 65536, workerMemoryLimitBytes: 134217728, contentValidation: { pdf: true, image: true, text: true }, privateRangeReadVerified: true, storageVerification: materialPolicy.storageVerification, r2WriteReadVerified: true, accountRemainingQuota: "unavailable", additionalPaidResources: false };
    await initializeMaterialInventory(db, ctx(1), crypto.randomUUID(), materialPolicy.maximumStorageBytes - 100, evidence, now);
    const first: TransferReservation = reservation(10);
    const reserveContext: Command = ctx(1);
    const receipt = await reserveMaterialTransfer(db, reserveContext, first);
    ensure((await reserveMaterialTransfer(db, reserveContext, first)).requestId === receipt.requestId, "예약 멱등");
    await reject(() => reserveMaterialTransfer(db, reserveContext, { ...first, metadata: { ...first.metadata, title: "다른 요청" } }), /request_key_reused/);
    ensure(await count("material_transfers") === 1 && (await getMaterialUsage(db, owner)).reservedBytes === 10, "중복 예약 없음"); checks.push("idempotent-reservation-and-payload-conflict");
    await reject(() => getMaterialTransfer(db, { realm: "sites", userId: "different-owner" }, first.id), /reference_conflict/); checks.push("cross-owner-transfer-denied");
    await reject(() => step(first.id, { type: "register" }), /reference_conflict/);
    await reject(() => db.prepare("UPDATE material_transfers SET state='registered',version=version+1 WHERE owner_id=? AND id=?").bind(owner.userId, first.id).run(), /invalid_material_transfer/);
    await reject(() => db.prepare("UPDATE uploads SET state='verified',verified_hash=expected_hash,version=version+1 WHERE owner_id=? AND id=?").bind(owner.userId, first.id).run(), /invalid_material_upload_projection/); checks.push("unverified-and-legacy-bypass-rejected");
    const startContext: Command = ctx(1);
    const started = await advanceMaterialTransfer(db, startContext, first.id, { type: "start" }, now);
    ensure((await advanceMaterialTransfer(db, startContext, first.id, { type: "start" }, now)).requestId === started.requestId, "전이 멱등");
    await reject(() => advanceMaterialTransfer(db, ctx(1), first.id, { type: "start" }, now), /version_conflict/); checks.push("transition-replay-and-stale-version");
    await step(first.id, { type: "multipart-created", multipartId: "synthetic-multipart" });
    await step(first.id, { type: "write-unknown", reason: "synthetic-response-loss" });
    await reject(() => advanceMaterialTransfer(db, ctx(4), first.id, { type: "cleanup" }, now + 3600000), /reference_conflict/);
    await reject(() => reserveMaterialTransfer(db, ctx(1), reservation(10)), /version_conflict/);
    ensure((await getMaterialUsage(db, owner)).reservedBytes === 10, "미확정 예약 보존"); checks.push("unknown-write-blocks-new-transfer-and-timeout-cleanup");
    const object = { objectVersion: "synthetic-v1", etag: "synthetic-etag", bytes: 10, sha256: metadata.sha256 };
    await step(first.id, { type: "write-succeeded", object });
    ensure((await getMaterialTransfer(db, owner, first.id)).snapshot.state === "stored" && await count("material_files") === 0, "R2 사실만 저장");
    await step(first.id, { type: "validate" });
    await reject(() => step(first.id, { type: "content-verified", content: { ...object, objectVersion: "different", kind: "text", pages: 1, policyVersion: materialPolicy.version } }), /reference_conflict/);
    await step(first.id, { type: "content-verified", content: { ...object, kind: "text", pages: 1, policyVersion: materialPolicy.version } }); checks.push("late-success-and-exact-object-validation");
    const before = await getMaterialTransfer(db, owner, first.id);
    const results = await Promise.allSettled([advanceMaterialTransfer(db, ctx(before.version), first.id, { type: "register" }, now), advanceMaterialTransfer(db, ctx(before.version), first.id, { type: "register" }, now)]);
    ensure(results.filter((r): boolean => r.status === "fulfilled").length === 1 && await count("material_files") === 1, "동시 확정 하나만 성공");
    const usage = await getMaterialUsage(db, owner);
    ensure(usage.reservedBytes === 0 && usage.occupiedBytes === materialPolicy.maximumStorageBytes - 90, "예약에서 확정 사용량으로 이동"); checks.push("concurrent-registration-single-winner-and-capacity");
    await reject(() => step(first.id, { type: "cleanup" }), /reference_conflict/);
    await reject(() => db.prepare("DELETE FROM material_files WHERE owner_id=?").bind(owner.userId).run(), /immutable/);
    await reject(() => db.prepare("DELETE FROM material_transfers WHERE owner_id=?").bind(owner.userId).run(), /immutable/); checks.push("registered-file-and-transfer-immutable");
    const tooLarge: TransferReservation = reservation(91);
    await reject(() => reserveMaterialTransfer(db, ctx(1), tooLarge), /version_conflict/);
    ensure(await count("materials") === 1 && await count("uploads") === 1, "용량 실패 전체 롤백");
    const exact: TransferReservation = reservation(90);
    await reserveMaterialTransfer(db, ctx(1), exact);
    ensure((await getMaterialUsage(db, owner)).occupiedBytes + (await getMaterialUsage(db, owner)).reservedBytes === materialPolicy.maximumStorageBytes, "정확한 256MiB 경계");
    await discard(exact.id); checks.push("exact-capacity-and-one-byte-overflow-atomicity");
    const simultaneous: readonly TransferReservation[] = [reservation(10), reservation(10)];
    const parallel = await Promise.allSettled(simultaneous.map((input): Promise<unknown> => reserveMaterialTransfer(db, ctx(1), input)));
    ensure(parallel.filter((r): boolean => r.status === "fulfilled").length === 1, "동시 예약 제한");
    const selected: TransferReservation = simultaneous[parallel.findIndex((r): boolean => r.status === "fulfilled")];
    await step(selected.id, { type: "start" }); await step(selected.id, { type: "multipart-created", multipartId: "synthetic-abort" });
    await step(selected.id, { type: "write-aborted", reason: "synthetic-abort-confirmed" });
    ensure((await getMaterialUsage(db, owner)).reservedBytes === 10, "abort만으로 예약 해제 금지");
    await discard(selected.id); ensure((await getMaterialUsage(db, owner)).reservedBytes === 0, "삭제 확인 후 해제"); checks.push("concurrent-reservations-and-confirmed-cleanup");
    const rollbackContext: Command = ctx(1);
    const marker: string = crypto.randomUUID();
    await reject(() => executeAtomic(db, rollbackContext, "material.test.zero-update", {}, marker, 2, (requestId: string): readonly D1PreparedStatement[] => [
      db.prepare("INSERT INTO courses VALUES (?,?,1,?,?)").bind(owner.userId, marker, requestId, "롤백 대상"),
      ...guardedUpdate(db, "courses", owner.userId, courseId, 999, requestId, 0, "title=?", ["불가능"], "1=1", []),
      db.prepare("INSERT INTO courses VALUES (?,?,1,?,?)").bind(owner.userId, crypto.randomUUID(), requestId, "뒤 변경"),
    ]), /version_conflict/);
    ensure(await count("courses") === 1 && await db.prepare("SELECT COUNT(*) AS n FROM atomic_requests WHERE owner_id=? AND request_key=?").bind(owner.userId, rollbackContext.requestKey).first<number>("n") === 0, "UPDATE 0 앞뒤·요청 롤백"); checks.push("zero-row-required-update-rolls-back-entire-d1-batch");
    const responseLoss: AtomicDatabase = {
      prepare: (query: string): D1PreparedStatement => db.prepare(query),
      batch: async (statements: D1PreparedStatement[]): Promise<never> => { await db.batch(statements); throw new Error("network response lost after committed batch"); },
    };
    const lostInput: TransferReservation = reservation(10);
    const lostContext: Command = ctx(1);
    const recovered = await reserveMaterialTransfer(responseLoss, lostContext, lostInput);
    ensure((await reserveMaterialTransfer(db, lostContext, lostInput)).requestId === recovered.requestId, "커밋 후 응답 유실 대사");
    ensure((await getMaterialUsage(db, owner)).reservedBytes === 10, "응답 유실 중복 예약 없음");
    await discard(lostInput.id); checks.push("committed-batch-response-loss-reconciles-once");
    await reject(() => reserveMaterialTransfer(db, ctx(1), { ...reservation(10), now: evidence.validUntil }), /version_conflict/); checks.push("expired-storage-evidence-blocks-registration");
    await db.prepare("UPDATE material_inventory SET blocked=1 WHERE owner_id=?").bind(owner.userId).run();
    await reject(() => reserveMaterialTransfer(db, ctx(1), reservation(10)), /version_conflict/); checks.push("storage-error-block-retains-existing-files");
    ensure((await db.prepare("PRAGMA foreign_key_check").all()).results.length === 0, "외래키 무결성"); checks.push("foreign-key-integrity");
  } catch (error: unknown) { failure = error; }
  try {
    await db.prepare("UPDATE verification_runs SET state='cleaning' WHERE owner_id=? AND id=?").bind(owner.userId, runId).run();
    await db.batch(cleanupTables.map((table: string): D1PreparedStatement => db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner.userId)));
    for (const table of cleanupTables) ensure(await count(table) === 0, `정리 ${table}`);
    await db.prepare("DELETE FROM verification_runs WHERE owner_id=? AND id=?").bind(owner.userId, runId).run();
  } catch (cleanupError: unknown) { throw new AggregateError([failure, cleanupError], "자료 상태 검사 또는 검사 범위 정리를 확인하지 못했습니다."); }
  if (failure !== null) throw failure;
  return { status: "passed", environment, schema: "0011_material_transfer_invariants", runId, startedAt, completedAt: new Date().toISOString(), checks, cleanup: "passed", realR2Writes: 0 };
}
