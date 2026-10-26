import type { SiteIdentity } from "../domain/contracts.ts";
import { storageMarkerKey, storageMarkerMaximumBytes } from "../backup/storage-identity.ts";
import type { AtomicDatabase } from "../../db/repositories/atomic.ts";
import { readStorage } from "../../db/repositories/atomic.ts";
import { getMaterialTransfer, getMaterialUsage } from "../../db/repositories/material-transfers.ts";
import type { MaterialUsage } from "../../db/repositories/material-transfers.ts";
import { requireMaterialObject } from "./object.ts";
import { materialFailure, materialPolicy, requireMaterialRuntime } from "./policy.ts";
import type { MaterialRuntimeEvidence } from "./policy.ts";

type InventoryRow = Readonly<{ id: string; version: number; last_request_id: string }>;
export type InventoryResult = Readonly<{ status: "verified"; checkedAt: number; validUntil: number; usage: MaterialUsage; accountRemainingQuota: "unavailable"; probeReservationBytes: number }>;
const probeReservationBytes: number = 1024;
const probePayload: string = "ALTER material storage verification";

/** 운영 v13~v18에서 통과한 고정 검사기·20MiB·64KiB·Range 규격의 증거를 참조합니다. */
function runtimeEvidence(now: number): MaterialRuntimeEvidence {
  return requireMaterialRuntime({ policyVersion: materialPolicy.version, deploymentId: "verified-profile:appgdep_6adc634943788191b5ea97cd3a793356", checkedAt: now, validUntil: now + 86400000, acceptedBodyBytes: 20971520, maximumBufferedBytes: 65536, workerMemoryLimitBytes: 134217728, contentValidation: { pdf: true, image: true, text: true }, privateRangeReadVerified: true, storageVerification: materialPolicy.storageVerification, r2WriteReadVerified: true, accountRemainingQuota: "unavailable", additionalPaidResources: false }, now);
}

/** 정해진 한 키에 1KiB를 항상 예약하므로 오래 지연된 진단 쓰기도 한도 밖으로 새지 않습니다. */
async function probeInventory(bucket: R2Bucket, key: string): Promise<void> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try {
      await bucket.put(key, probePayload, { httpMetadata: { contentType: "text/plain" } });
      const object: R2ObjectBody | null = await bucket.get(key);
      if (object === null || object.size !== new TextEncoder().encode(probePayload).length) { await object?.body.cancel(); throw materialFailure("material_storage_unavailable", "inventory-probe-size", 503); }
      if (await object.text() !== probePayload) throw materialFailure("material_storage_unavailable", "inventory-probe-content", 503);
      await bucket.delete(key);
      if (await bucket.head(key) !== null) throw materialFailure("material_storage_unavailable", "inventory-probe-cleanup", 503);
      return;
    } catch (error: unknown) {
      if (attempt === 3) throw error;
      console.warn({ event: "material_inventory_probe_retry", attempt, operation: "fixed-key-write-read-delete", errorType: error instanceof Error ? error.name : "unknown" });
    }
  }
  throw materialFailure("material_storage_unavailable", "inventory-probe-retries", 503);
}

/** 객체 목록은 페이지별로 처리하고 원본 내용을 메모리에 모으지 않습니다. */
async function inventoryBytes(db: AtomicDatabase, bucket: R2Bucket, owner: SiteIdentity, probeKey: string): Promise<number> {
  const registered = await readStorage("material.inventory.registered", () => db.prepare("SELECT t.id,u.object_key FROM material_transfers t JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE t.owner_id=? AND t.state='registered'").bind(owner.userId).all<{ id: string; object_key: string }>());
  const expected: ReadonlyMap<string, string> = new Map(registered.results.map((row): [string, string] => [row.object_key, row.id]));
  const found: Set<string> = new Set<string>();
  const hasRegistration = await readStorage("material.inventory.restore-reservation", () => db.prepare("SELECT slot FROM restore_storage WHERE slot=1").first<{ slot: number }>());
  const markerReservation: number = hasRegistration === null ? 0 : storageMarkerMaximumBytes;
  let untracked: number = probeReservationBytes + markerReservation;
  let cursor: string | undefined;
  for (let page: number = 0; page < 100; page += 1) {
    const listed: R2Objects = await readStorage("material.inventory.list", () => bucket.list({ limit: 1000, cursor }));
    for (const object of listed.objects) {
      if (object.key === probeKey) {
        if (object.size > probeReservationBytes) throw materialFailure("material_storage_unavailable", "inventory-probe-capacity", 507);
        continue;
      }
      if (object.key === storageMarkerKey && markerReservation > 0) {
        if (object.size > markerReservation) throw materialFailure("material_storage_unavailable", "restore-marker-capacity", 507);
        continue;
      }
      const id: string | undefined = expected.get(object.key);
      if (id === undefined) untracked += object.size;
      else { const head: R2Object | null = await readStorage("material.inventory.head", () => bucket.head(object.key)); if (head === null) throw materialFailure("material_storage_unavailable", "registered-object-missing", 409); requireMaterialObject(head, await getMaterialTransfer(db, owner, id)); found.add(object.key); }
      if (!Number.isSafeInteger(untracked) || untracked > materialPolicy.maximumStorageBytes) throw materialFailure("material_storage_unavailable", "application-capacity", 507);
    }
    if (!listed.truncated) {
      if (found.size !== expected.size) throw materialFailure("material_storage_unavailable", "registered-object-missing", 409);
      return untracked;
    }
    cursor = listed.cursor;
  }
  throw materialFailure("material_storage_unavailable", "inventory-list-limit", 503);
}

/** 활성 전송이 없을 때 등록을 잠근 후 전체 R2와 대사합니다. 실패·중단 시 차단을 유지합니다. */
export async function verifyMaterialInventory(db: AtomicDatabase, bucket: R2Bucket, owner: SiteIdentity, now: number): Promise<InventoryResult> {
  const auditId: string = crypto.randomUUID();
  await readStorage("material.inventory.prepare", () => db.prepare("INSERT INTO material_inventory VALUES (?,?,1,?,0,'{}',1,?,?) ON CONFLICT(owner_id) DO NOTHING").bind(owner.userId, crypto.randomUUID(), auditId, now, now + 1).run());
  const locked: InventoryRow | null = await readStorage("material.inventory.lock", () => db.prepare("UPDATE material_inventory SET blocked=1,version=version+1,last_request_id=? WHERE owner_id=? AND NOT EXISTS(SELECT 1 FROM material_transfers WHERE owner_id=? AND state NOT IN ('registered','discarded')) RETURNING id,version,last_request_id").bind(auditId, owner.userId, owner.userId).first<InventoryRow>());
  if (locked === null) throw materialFailure("material_storage_unavailable", "finish-or-cleanup-current-transfer", 409);
  const probeKey: string = `diagnostics/material-inventory/${locked.id}`;
  const untracked: number = await inventoryBytes(db, bucket, owner, probeKey);
  const current: MaterialUsage = await getMaterialUsage(db, owner);
  if (current.occupiedBytes - current.untrackedBytes + untracked > materialPolicy.maximumStorageBytes) throw materialFailure("material_storage_unavailable", "application-capacity", 507);
  await probeInventory(bucket, probeKey);
  const evidence: MaterialRuntimeEvidence = runtimeEvidence(now);
  const committed: number | null = await readStorage("material.inventory.commit", () => db.prepare("UPDATE material_inventory SET blocked=0,version=version+1,untracked_bytes=?,evidence=?,checked_at=?,valid_until=? WHERE owner_id=? AND id=? AND version=? AND last_request_id=? AND blocked=1 RETURNING version").bind(untracked, JSON.stringify(evidence), now, evidence.validUntil, owner.userId, locked.id, locked.version, auditId).first<number>("version"));
  if (committed === null) throw materialFailure("material_storage_unavailable", "inventory-superseded", 409);
  return { status: "verified", checkedAt: now, validUntil: evidence.validUntil, usage: await getMaterialUsage(db, owner), accountRemainingQuota: "unavailable", probeReservationBytes };
}
