import { command, recordId } from "../domain/contracts.ts";
import type { Command, SiteIdentity } from "../domain/contracts.ts";
import { getMaterialTransfer, getMaterialUsage, reserveMaterialTransfer } from "../../db/repositories/material-transfers.ts";
import type { StoredTransfer, TransferReservation } from "../../db/repositories/material-transfers.ts";
import { isDomainFailure, readStorage } from "../../db/repositories/atomic.ts";
import type { AtomicDatabase } from "../../db/repositories/atomic.ts";
import { parseMaterialStart } from "./request.ts";
import type { MaterialStartInput } from "./request.ts";
import { materialFailure, requireMaterialStorage } from "./policy.ts";

async function previousReservation(db: AtomicDatabase, owner: SiteIdentity, requestKey: string): Promise<StoredTransfer | null> {
  const id: string | null = await readStorage("material.start.replay", (): Promise<string | null> => db.prepare("SELECT json_extract(result_json,'$.entityId') AS id FROM atomic_requests WHERE owner_id=? AND scope='material.transfer.reserve' AND request_key=?").bind(owner.userId, requestKey).first<string>("id"));
  return id === null ? null : getMaterialTransfer(db, owner, id);
}

function reservation(input: MaterialStartInput, previous: StoredTransfer | null, now: number): TransferReservation {
  return { id: recordId.parse(previous === null ? crypto.randomUUID() : previous.id), materialId: recordId.parse(previous === null ? crypto.randomUUID() : previous.materialId), uploadId: recordId.parse(previous === null ? crypto.randomUUID() : previous.uploadId), courseId: input.courseId, metadata: input.metadata, now: previous === null ? now : previous.reservedAt };
}

/** 소유자 검사 이후 호출하며 동일 요청의 서버 생성 ID를 재사용합니다. 원본 객체 쓰기는 시작하지 않습니다. */
export async function startMaterialTransfer(db: AtomicDatabase, owner: SiteIdentity, requestKey: string, value: MaterialStartInput, now: number): Promise<StoredTransfer> {
  const input: MaterialStartInput = parseMaterialStart(value);
  const context: Command = command.parse({ owner, requestKey: recordId.parse(requestKey), expectedVersion: 1 });
  const previous: StoredTransfer | null = await previousReservation(db, owner, requestKey);
  const course: number | null = await readStorage("material.course.owner", (): Promise<number | null> => db.prepare("SELECT 1 AS owned FROM courses WHERE owner_id=? AND id=?").bind(owner.userId, input.courseId).first<number>("owned"));
  if (course !== 1) throw materialFailure("material_not_found", "course", 404);
  const intended: TransferReservation = reservation(input, previous, now);
  try {
    if (previous === null) {
      const usage = await getMaterialUsage(db, owner);
      if (usage.blocked || usage.activeTransfers > 0) throw materialFailure("material_storage_unavailable", "storage-blocked-or-active-transfer", 409);
      requireMaterialStorage(usage.occupiedBytes, usage.reservedBytes, input.metadata.bytes);
    }
    await reserveMaterialTransfer(db, context, intended);
  } catch (error: unknown) {
    const concurrentConflict: boolean = isDomainFailure(error) && ["request_key_reused", "version_conflict"].includes(error.code) || error instanceof Error && "code" in error && error.code === "material_storage_unavailable";
    if (!concurrentConflict || previous !== null) throw error;
    const concurrent: StoredTransfer | null = await previousReservation(db, owner, requestKey);
    if (concurrent === null) throw error;
    const replay: TransferReservation = reservation(input, concurrent, now);
    await reserveMaterialTransfer(db, context, replay);
    return getMaterialTransfer(db, owner, replay.id);
  }
  return getMaterialTransfer(db, owner, intended.id);
}
