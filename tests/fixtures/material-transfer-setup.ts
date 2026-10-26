import { recordId } from "../../lib/domain/contracts";
import type { SiteIdentity } from "../../lib/domain/contracts";
import { createCourse } from "../../db/repositories/courses";
import { initializeMaterialInventory, reserveMaterialTransfer } from "../../db/repositories/material-transfers";
import { materialPolicy, validateMaterialMetadata } from "../../lib/materials/policy";
import type { MaterialRuntimeEvidence } from "../../lib/materials/policy";

export async function initializeUploadFixture(db: D1Database, request: Request): Promise<Readonly<{ owner: SiteIdentity; id: string }>> {
  return initializeOwnedUploadFixture(db, request, { realm: "sites", userId: `upload-test:${crypto.randomUUID()}` });
}
export async function initializeOwnedUploadFixture(db: D1Database, request: Request, owner: SiteIdentity): Promise<Readonly<{ owner: SiteIdentity; id: string }>> {
  const id = recordId.parse(crypto.randomUUID());
  const materialId = recordId.parse(crypto.randomUUID());
  const courseId = recordId.parse(crypto.randomUUID());
  const now: number = Date.now();
  const metadata = validateMaterialMetadata({ title: "전송 검사", edition: request.headers.get("x-fixture-edition") ?? "", role: request.headers.get("x-fixture-role") ?? "reference", kind: request.headers.get("x-fixture-kind"), filename: request.headers.get("x-fixture-filename"), mime: request.headers.get("content-type"), bytes: Number(request.headers.get("x-fixture-bytes")), sha256: request.headers.get("x-fixture-sha256") });
  const context = { owner, requestKey: crypto.randomUUID(), expectedVersion: 1 };
  await createCourse(db, context, { id: courseId, title: "전송 검사" });
  const evidence: MaterialRuntimeEvidence = { policyVersion: materialPolicy.version, deploymentId: "synthetic-upload-fixture", checkedAt: now, validUntil: now + 3600000, acceptedBodyBytes: 20971520, maximumBufferedBytes: 65536, workerMemoryLimitBytes: 134217728, contentValidation: { pdf: true, image: true, text: true }, privateRangeReadVerified: true, storageVerification: materialPolicy.storageVerification, r2WriteReadVerified: true, accountRemainingQuota: "unavailable", additionalPaidResources: false };
  const inventoryCount: number | null = await db.prepare("SELECT COUNT(*) AS n FROM material_inventory WHERE owner_id=?").bind(owner.userId).first<number>("n");
  if (inventoryCount === 0) await initializeMaterialInventory(db, { ...context, requestKey: crypto.randomUUID() }, crypto.randomUUID(), 0, evidence, now);
  await reserveMaterialTransfer(db, { ...context, requestKey: crypto.randomUUID() }, { id, materialId, uploadId: recordId.parse(crypto.randomUUID()), courseId, metadata, now });
  return { owner, id };
}
