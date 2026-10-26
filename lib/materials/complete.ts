import { version } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { getMaterialTransfer } from "../../db/repositories/material-transfers.ts";
import type { StoredTransfer } from "../../db/repositories/material-transfers.ts";
import { materialFailure, materialPolicy } from "./policy.ts";
import type { MaterialFailure } from "./policy.ts";
import { headMaterialObject, readMaterialObject } from "./object.ts";
import { transitionMaterialTransfer } from "./transition.ts";
import { validatePdfStructure } from "./pdf-content";
import { pdfR2Source } from "./pdf-r2";
import { validatePngContent } from "./png-content";
import { validateJpegContent } from "./jpeg-content";
import { validateTextContent } from "./text-content";
import { transferMaterialBytes } from "./stream";
import type { ContentFact } from "./transfer-state.ts";
import { canRevalidateMaterial } from "./transfer-state.ts";

export type MaterialDecoders = Readonly<{ pdf: WebAssembly.Module; jpeg: WebAssembly.Module }>;
export type MaterialRegistration = Readonly<{ id: string; materialId: string; version: number; state: "registered"; pages: number }>;

async function checkMaterialContent(bucket: R2Bucket, transfer: StoredTransfer, decoders: MaterialDecoders, signal: AbortSignal): Promise<ContentFact> {
  await headMaterialObject(bucket, transfer);
  const object: R2ObjectBody = await readMaterialObject(bucket, transfer);
  let pages: number;
  if (transfer.metadata.kind === "pdf") {
    await transferMaterialBytes(object.body, new WritableStream<Uint8Array>({ write(): void {} }), transfer.metadata, signal);
    const pdf = await validatePdfStructure(pdfR2Source(bucket, transfer.objectKey, object), signal, decoders.pdf);
    pages = pdf.pages;
  } else if (transfer.metadata.kind === "text") {
    pages = (await validateTextContent(object.body, transfer.metadata, signal)).pages;
  } else if (transfer.metadata.mime === "image/png") {
    pages = (await validatePngContent(object.body, transfer.metadata, signal)).pages;
  } else if (transfer.metadata.mime === "image/jpeg") {
    pages = (await validateJpegContent(object.body, transfer.metadata, signal, decoders.jpeg)).pages;
  } else throw materialFailure("material_type_mismatch", "content-validator", 415);
  await headMaterialObject(bucket, transfer);
  return { objectVersion: object.version, etag: object.etag, sha256: transfer.metadata.sha256, bytes: object.size, kind: transfer.metadata.kind, pages, policyVersion: materialPolicy.version };
}

function registration(transfer: StoredTransfer): MaterialRegistration {
  if (transfer.snapshot.state !== "registered" || transfer.snapshot.validation === null) throw materialFailure("material_version_conflict", "registration-not-confirmed", 409);
  return { id: transfer.id, materialId: transfer.materialId, version: transfer.version, state: "registered", pages: transfer.snapshot.validation.pages };
}

/** 내용 검증과 동일 버전 재확인 후 D1 상태·자료 연결을 한 batch로 확정합니다. */
export async function completeMaterialTransfer(db: D1Database, bucket: R2Bucket, owner: SiteIdentity, id: string, expectedVersion: number, decoders: MaterialDecoders, requestSignal: AbortSignal): Promise<MaterialRegistration> {
  version.parse(expectedVersion);
  let current: StoredTransfer = await getMaterialTransfer(db, owner, id);
  if (current.snapshot.state === "registered") return registration(current);
  if (current.version !== expectedVersion || (!["stored", "validating", "verified"].includes(current.snapshot.state) && !canRevalidateMaterial(current.snapshot, current.metadata))) throw materialFailure("material_version_conflict", "completion-state", 409);
  if (current.snapshot.state === "validating" && Date.now() - current.snapshot.updatedAt < materialPolicy.validationTimeoutMs) throw materialFailure("material_version_conflict", "validation-in-progress", 409);
  const signal: AbortSignal = AbortSignal.any([requestSignal, AbortSignal.timeout(materialPolicy.validationTimeoutMs)]);
  const dispatchId: string = crypto.randomUUID();
  if (current.snapshot.state !== "verified") {
    current = await transitionMaterialTransfer(db, owner, current, { type: current.snapshot.state === "failed" ? current.metadata.mime === "application/pdf" ? "revalidate-pdf" : "revalidate-jpeg" : "validate" }, dispatchId);
    let proof: ContentFact;
    try { proof = await checkMaterialContent(bucket, current, decoders, signal); }
    catch (error: unknown) {
      const failure: MaterialFailure | null = error instanceof Error && error.name === "MaterialFailure" ? error as MaterialFailure : null;
      console.warn({ event: "material_content_validation_failed", transferId: current.id, errorType: error instanceof Error ? error.name : "unknown", code: failure?.code, field: failure?.field, status: failure?.status, cancelled: signal.aborted });
      if (!signal.aborted && error instanceof Error && error.name === "MaterialFailure") {
        try { await transitionMaterialTransfer(db, owner, current, { type: "content-failed", reason: `${(error as MaterialFailure).code}:${(error as MaterialFailure).field}`.slice(0, 200) }, dispatchId); }
        catch (preservationError: unknown) { throw new AggregateError([error, preservationError], "자료 검증 실패 기록도 확인하지 못했습니다. 등록하지 않고 상태를 재조회해야 합니다."); }
      }
      if (error instanceof Error && error.name === "TimeoutError") throw Object.assign(materialFailure("material_runtime_unverified", "validation-timeout-retained", 503), { cause: error });
      throw error;
    }
    current = await transitionMaterialTransfer(db, owner, current, { type: "content-verified", content: proof }, dispatchId);
  }
  signal.throwIfAborted();
  await headMaterialObject(bucket, current);
  current = await transitionMaterialTransfer(db, owner, current, { type: "register" }, dispatchId);
  return registration(current);
}
