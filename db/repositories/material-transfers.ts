import { z } from "zod";
import { command, domainFailure, recordId, timestamp } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { materialMetadata, materialPolicy, requireMaterialRuntime, validateMaterialMetadata } from "../../lib/materials/policy.ts";
import type { MaterialMetadata, MaterialRuntimeEvidence } from "../../lib/materials/policy.ts";
import { contentFact, evolveTransfer, legacyUploadState, transferSnapshot } from "../../lib/materials/transfer-state.ts";
import type { TransferEvent, TransferSnapshot } from "../../lib/materials/transfer-state.ts";
import { executeAtomic, guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { AtomicDatabase, Receipt } from "./atomic.ts";
import { uploadObjectKey } from "./materials.ts";

const transferReservation = z.object({ id: recordId, materialId: recordId, uploadId: recordId, courseId: recordId, metadata: materialMetadata, now: timestamp }).strict();
export type TransferReservation = Readonly<z.infer<typeof transferReservation>>;
export type StoredTransfer = Readonly<{ id: string; materialId: string; uploadId: string; objectKey: string; version: number; courseId: string; reservedAt: number; metadata: MaterialMetadata; snapshot: TransferSnapshot }>;
export type TransferRow = Readonly<{ id: string; material_id: string; upload_id: string; object_key: string; version: number; course_id: string; recovery_at: number; metadata: string; state: string; write_status: string; multipart_id: string | null; object_version: string | null; etag: string | null; actual_hash: string | null; actual_bytes: number | null; validation: string | null; failure_code: string | null; updated_at: number }>;
export type MaterialUsage = Readonly<{ occupiedBytes: number; reservedBytes: number; untrackedBytes: number; activeTransfers: number; blocked: boolean }>;
const allocationSql: string = "COALESCE((SELECT SUM(u.bytes) FROM material_transfers t JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE t.owner_id=? AND t.state != 'discarded'),0)";
const activeSql: string = "(SELECT COUNT(*) FROM material_transfers WHERE owner_id=? AND state NOT IN ('registered','discarded'))";

/** 초기 R2 전체 대사 결과를 등록하며 기존 원장을 무조건 덮어쓰지 않습니다. */
export async function initializeMaterialInventory(db: AtomicDatabase, context: Command, id: string, untrackedBytes: number, evidence: MaterialRuntimeEvidence, now: number): Promise<Receipt> {
  recordId.parse(id); requireMaterialRuntime(evidence, now);
  z.number().int().nonnegative().max(materialPolicy.maximumStorageBytes).parse(untrackedBytes);
  return executeAtomic(db, context, "material.inventory.initialize", { id, untrackedBytes, evidence, now }, id, 1, (requestId: string): readonly D1PreparedStatement[] => [
    requireInBatch(db, context.owner.userId, requestId, 0, `${activeSql}=0`, [context.owner.userId]),
    db.prepare("INSERT INTO material_inventory VALUES (?,?,1,?,?,?,0,?,?)").bind(context.owner.userId, id, requestId, untrackedBytes, JSON.stringify(evidence), now, evidence.validUntil),
  ]);
}

/** 요청 키・용량 예약・두 상태 행을 하나의 batch에 넣습니다. */
export async function reserveMaterialTransfer(db: AtomicDatabase, context: Command, value: TransferReservation): Promise<Receipt> {
  const input: TransferReservation = transferReservation.parse(value);
  validateMaterialMetadata(input.metadata);
  return executeAtomic(db, context, "material.transfer.reserve", input, input.id, 1, requestId=>materialTransferReservationStatements(db,context.owner,input,requestId));
}

/** 동일한 용량 예약 계약을 로컬 파일과 검증된 Google 사본이 재사용합니다. */
export function materialTransferReservationStatements(db:AtomicDatabase,owner:SiteIdentity,value:TransferReservation,requestId:string):readonly D1PreparedStatement[] {
  const input=transferReservation.parse(value);validateMaterialMetadata(input.metadata);const ownerId:string=owner.userId;
  const key:string=uploadObjectKey({id:input.id,materialId:input.materialId,uploadId:input.uploadId,expectedHash:input.metadata.sha256,bytes:input.metadata.bytes,recoveryAt:input.now});
  return [
    requireInBatch(db, ownerId, requestId, 0, `EXISTS(SELECT 1 FROM material_inventory WHERE owner_id=? AND blocked=0 AND checked_at<=? AND valid_until>? AND untracked_bytes+${allocationSql}+?<=? AND ${activeSql}<?)`, [ownerId, input.now, input.now, ownerId, input.metadata.bytes, materialPolicy.maximumStorageBytes, ownerId, materialPolicy.maximumConcurrentTransfers]),
    db.prepare("INSERT INTO materials VALUES (?,?,1,?,?,?,'upload',NULL,NULL)").bind(ownerId, input.materialId, requestId, input.courseId, input.metadata.title),
    db.prepare("INSERT INTO uploads VALUES (?,?,1,?,?,?,?,'reserved',?,NULL,?,?)").bind(ownerId, input.id, requestId, input.materialId, key, input.uploadId, input.metadata.sha256, input.metadata.bytes, input.now),
    db.prepare("INSERT INTO material_transfers VALUES (?,?,?,1,?,?,'reserved','not-started',NULL,NULL,NULL,NULL,NULL,NULL,NULL,?)").bind(ownerId, input.id, input.materialId, requestId, JSON.stringify(input.metadata), input.now),
  ];
}

/** 임의 객체 키 대신 소유자와 업로드 식별자로만 상태를 읽습니다. */
export async function getMaterialTransfer(db: AtomicDatabase, owner: SiteIdentity, id: string): Promise<StoredTransfer> {
  recordId.parse(id);
  const row: TransferRow | null = await readStorage("material.transfer.get", (): Promise<TransferRow | null> => db.prepare("SELECT t.*,u.upload_id,u.object_key,u.recovery_at,m.course_id FROM material_transfers t JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id JOIN materials m ON m.owner_id=t.owner_id AND m.id=t.material_id WHERE t.owner_id=? AND t.id=?").bind(owner.userId, id).first<TransferRow>());
  if (row === null) throw domainFailure("reference_conflict", "material.transfer.get", null);
  return materialTransferFromRow(row);
}

/** 일반 조회와 백업 스냅샷 조회가 같은 원본 상태 검증을 사용합니다. */
export function materialTransferFromRow(row: TransferRow): StoredTransfer {
  const metadata: MaterialMetadata = validateMaterialMetadata(JSON.parse(row.metadata));
  const snapshot: TransferSnapshot = transferSnapshot.parse({ state: row.state, writeStatus: row.write_status, multipartId: row.multipart_id, object: row.object_version === null ? null : { objectVersion: row.object_version, etag: row.etag, sha256: row.actual_hash, bytes: row.actual_bytes }, validation: row.validation === null ? null : contentFact.parse(JSON.parse(row.validation)), failureCode: row.failure_code, updatedAt: row.updated_at });
  return { id: row.id, materialId: row.material_id, uploadId: row.upload_id, objectKey: row.object_key, version: row.version, courseId: row.course_id, reservedAt: row.recovery_at, metadata, snapshot };
}

/** 재실행은 저장된 결과를 반환하고 오래된 버전의 필수 UPDATE 0건은 전체 batch를 취소합니다. */
export async function advanceMaterialTransfer(db: AtomicDatabase, context: Command, id: string, event: TransferEvent, now: number): Promise<Receipt> {
  command.parse(context); recordId.parse(id); timestamp.parse(now);
  const current: StoredTransfer = await getMaterialTransfer(db, context.owner, id);
  return executeAtomic(db, context, "material.transfer.advance", { id, event, now }, id, context.expectedVersion + 1, (requestId: string): readonly D1PreparedStatement[] => {
    if (current.version !== context.expectedVersion) throw domainFailure("version_conflict", "material.transfer.advance", null);
    const next: TransferSnapshot = evolveTransfer(current.snapshot, event, current.metadata, now);
    const ownerId: string = context.owner.userId;
    const result: D1PreparedStatement[] = [
      ...guardedUpdate(db, "material_transfers", ownerId, id, context.expectedVersion, requestId, 0, "state=?,write_status=?,multipart_id=?,object_version=?,etag=?,actual_hash=?,actual_bytes=?,validation=?,failure_code=?,updated_at=?", [next.state, next.writeStatus, next.multipartId, next.object?.objectVersion ?? null, next.object?.etag ?? null, next.object?.sha256 ?? null, next.object?.bytes ?? null, next.validation === null ? null : JSON.stringify(next.validation), next.failureCode, now], "state=?", [current.snapshot.state]),
      ...guardedUpdate(db, "uploads", ownerId, id, context.expectedVersion, requestId, 1, "state=?,verified_hash=?", [legacyUploadState(next.state), next.state === "registered" ? current.metadata.sha256 : null], "material_id=? AND object_key=? AND expected_hash=? AND bytes=?", [current.materialId, current.objectKey, current.metadata.sha256, current.metadata.bytes]),
    ];
    if (event.type === "register") result.push(
      requireInBatch(db, ownerId, requestId, 2, "EXISTS(SELECT 1 FROM material_inventory WHERE owner_id=? AND blocked=0 AND checked_at<=? AND valid_until>?)", [ownerId, now, now]),
      db.prepare("INSERT INTO material_files VALUES (?,?,?,?)").bind(ownerId, current.materialId, id, now),
    );
    return result;
  });
}

/** 미확정·실패 상태는 삭제 확인까지 예약에서 차감하지 않습니다. */
export async function getMaterialUsage(db: AtomicDatabase, owner: SiteIdentity): Promise<MaterialUsage> {
  type UsageRow = Readonly<{ occupied: number; reserved: number; untracked_bytes: number; active: number; blocked: number }>;
  const row: UsageRow | null = await readStorage("material.usage", (): Promise<UsageRow | null> => db.prepare("SELECT i.untracked_bytes,CASE WHEN i.blocked=1 OR i.valid_until<=unixepoch('subsec')*1000 THEN 1 ELSE 0 END AS blocked,COALESCE(SUM(CASE WHEN t.state='registered' THEN u.bytes ELSE 0 END),0) AS occupied,COALESCE(SUM(CASE WHEN t.state NOT IN ('registered','discarded') THEN u.bytes ELSE 0 END),0) AS reserved,COUNT(CASE WHEN t.state NOT IN ('registered','discarded') THEN 1 END) AS active FROM material_inventory i LEFT JOIN material_transfers t ON t.owner_id=i.owner_id LEFT JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE i.owner_id=? GROUP BY i.owner_id").bind(owner.userId).first<UsageRow>());
  if (row === null) throw domainFailure("reference_conflict", "material.usage", null);
  return { occupiedBytes: row.occupied + row.untracked_bytes, reservedBytes: row.reserved, untrackedBytes: row.untracked_bytes, activeTransfers: row.active, blocked: row.blocked !== 0 };
}
