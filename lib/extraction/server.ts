import { z } from "zod";
import type { SiteIdentity } from "../domain/contracts.ts";
import { getRegisteredMaterial } from "../materials/download.ts";
import { headMaterialObject } from "../materials/object.ts";
import { materialFileReference } from "../materials/attachment.ts";
import { materialFailure } from "../materials/policy.ts";
import { validatePngContent } from "../materials/png-content.ts";
import { requireMaterialVisibility } from "../../db/repositories/material-access.ts";
import { getExtractionJob } from "../../db/repositories/extraction-jobs.ts";
import type { ExtractionJob } from "../../db/repositories/extraction-jobs.ts";
import type { StoredTransfer } from "../../db/repositories/material-transfers.ts";
import { requireSelectedPage, validateSelection } from "./selection.ts";
import { preparedPageImage, requireImageGeometry } from "./image.ts";
import type { PreparedPageImage } from "./image.ts";
import { pageResult, validatePageResult } from "./result.ts";
import type { PageResult } from "./result.ts";

import type { PreparedAiRequest } from "../ai/request-bound.ts";
import type { PageVisionRequest } from "./vision.ts";
import { domainFailure } from "../domain/contracts.ts";

export const extractionPageInput = z.object({ selectionRevision: z.number().int().positive(), filePage: z.number().int().positive().max(500) }).strict();
export const extractionTextInput = extractionPageInput.extend({ expectedVersion: z.number().int().nonnegative(), result: pageResult }).strict();
export const extractionImageInput = extractionPageInput.extend({ image: preparedPageImage }).strict();
export type VerifiedExtractionPage = Readonly<{ owner: SiteIdentity; job: ExtractionJob; transfer: StoredTransfer; filePage: number }>;

/** 페이지 번호 주장만으로 허용하지 않고 현재 선택과 불변의 등록 원본을 다시 조회합니다. */
export async function requireExtractionPage(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, materialId: string, revision: number, filePage: number): Promise<VerifiedExtractionPage> {
  await requireMaterialVisibility(db, owner);
  const transfer: StoredTransfer = await getRegisteredMaterial(db, owner, materialId);
  await headMaterialObject(bucket, transfer);
  const job: ExtractionJob | null = await getExtractionJob(db, owner, materialId);
  if (job === null) throw materialFailure("material_access_required", "selection-required", 409);
  try { validateSelection(job.selection, materialFileReference(transfer)); requireSelectedPage(job, materialId, revision, filePage); }
  catch (error: unknown) { if (error instanceof z.ZodError || error instanceof Error) throw Object.assign(materialFailure("material_version_conflict", "selection-or-original-version", 409), { cause: error }); throw error; }
  if (job.uploadId !== transfer.id) throw materialFailure("material_version_conflict", "original-upload", 409);
  return { owner, job, transfer, filePage };
}

export function requireExtractionText(page: VerifiedExtractionPage, value: unknown): PageResult {
  let result: PageResult;
  try { result = validatePageResult(value, page.filePage); } catch (error: unknown) { throw Object.assign(materialFailure("material_request_invalid", "page-result", 400), { cause: error }); }
  if (result.method !== (page.transfer.metadata.kind === "text" ? "plain-text" : "text-layer") || page.transfer.metadata.kind === "image") throw materialFailure("material_request_invalid", "text-extraction-method", 400);
  return result;
}

/** 준비 이미지는 원본 자체로 간주하지 않고 실제 PNG 바이트와 좌표를 별도로 검증합니다. */
export async function requireExtractionImage(page: VerifiedExtractionPage, value: unknown, signal: AbortSignal): Promise<PreparedPageImage> {
  const image: PreparedPageImage = preparedPageImage.parse(value);
  try { requireImageGeometry(image); } catch (error: unknown) { throw Object.assign(materialFailure("material_request_invalid", "page-image-geometry", 400), { cause: error }); }
  if (image.mime !== "image/png" || !(page.transfer.metadata.kind === "pdf" ? ["pdf-viewport", "pdf-raster", "pdf-region"].includes(image.coordinateSpace) : image.coordinateSpace === "decoded-image") || page.transfer.metadata.kind === "text") throw materialFailure("material_request_invalid", "page-image-format", 415);
  const base64: string = image.dataUrl.slice(image.dataUrl.indexOf(",") + 1);
  if (base64.length % 4 !== 0 || base64.length * 3 / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0) !== image.bytes) throw materialFailure("material_body_length_invalid", "page-image-length", 400);
  const binary: string = atob(base64);
  const bytes: Uint8Array<ArrayBuffer> = Uint8Array.from(binary, (character: string): number => character.charCodeAt(0));
  if (bytes.length < 24 || new DataView(bytes.buffer).getUint32(16) !== image.width || new DataView(bytes.buffer).getUint32(20) !== image.height) throw materialFailure("material_content_invalid", "page-image-dimensions", 422);
  const proof = await validatePngContent(new Blob([bytes]).stream(), { title: "선택 페이지 판독 입력", edition: "", role: "reference", kind: "image", filename: "selected-page.png", mime: "image/png", bytes: image.bytes, sha256: image.sha256 }, signal);
  if (proof.image.width !== image.width || proof.image.height !== image.height) throw materialFailure("material_content_invalid", "page-image-dimensions", 422);
  return image;
}

/** 공통 예약·중복·정산 경로 안에서 재시도마다 원본과 선택을 다시 대조합니다. */
export async function authorizePageVision(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, expectedOwner: SiteIdentity, page: VerifiedExtractionPage, image: PreparedPageImage, prepared: PreparedAiRequest, expected: PageVisionRequest, signal: AbortSignal): Promise<void> {
  if (owner.userId !== expectedOwner.userId || prepared.requestFingerprint !== expected.fingerprint || prepared.imageCount !== 1) throw domainFailure("reference_conflict", "extraction.vision.source", null);
  const current = await requireExtractionPage(db, bucket, owner, page.job.jobId, page.job.revision, page.filePage);
  await requireExtractionImage(current, image, signal);
}

