import type { SiteIdentity } from "../domain/contracts.ts";
import { requireMaterialVisibility } from "../../db/repositories/material-access.ts";
import { getExtractionJob } from "../../db/repositories/extraction-jobs.ts";
import { getExtractionPage } from "../../db/repositories/extraction-pages.ts";
import { readExtractionSource } from "../../db/repositories/extraction-sources.ts";
import { getRegisteredMaterial } from "../materials/download.ts";
import { materialFileReference } from "../materials/attachment.ts";
import { headMaterialObject } from "../materials/object.ts";
import { judgeExtractionSource } from "./source.ts";
import type { SourceJudgment } from "./source.ts";

/** 후속 소비자는 매번 이 어댑터로 원본 접근과 현재 결과를 확인해야 합니다. */
export async function resolveExtractionSource(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, sourceId: string): Promise<SourceJudgment> {
  await requireMaterialVisibility(db, owner);
  return inspectExtractionSource(db,bucket,owner,sourceId);
}
/** 서버 내부 평가용 검사이며 이 결과를 인출 화면에 그대로 반환하지 않습니다. */
export async function inspectExtractionSource(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,sourceId:string):Promise<SourceJudgment> {
  const source = await readExtractionSource(db, owner, sourceId);
  if (source === null) return { valid: false, reason: "deleted" };
  const transfer = await getRegisteredMaterial(db, owner, source.materialId);
  await headMaterialObject(bucket, transfer);
  const job = await getExtractionJob(db, owner, source.materialId);
  if (job === null) return { valid: false, reason: "deleted" };
  const original = materialFileReference(transfer);
  const page = await getExtractionPage(db, owner, source.extractionPageId);
  return judgeExtractionSource(source, { ownerId: owner.userId, materialId: transfer.materialId, uploadId: transfer.id, originalVersion: original.objectVersion, originalHash: original.sha256, selectionRevision: job.revision, page });
}
