import { deletePrivateObject } from "../r2-access";
import { materialFailure } from "./policy";
import type { MaterialMetadata } from "./policy";
import { transferMaterialBytes } from "./stream";
import type { MaterialStreamProof } from "./stream";
import { validatePdfStructure } from "./pdf-content";
import type { PdfStructureProof } from "./pdf-content";
import { pdfR2Source } from "./pdf-r2";

export type PdfProbeProof = Readonly<{ checkedAt: string; transfer: MaterialStreamProof; pdf: PdfStructureProof; cleanup: "passed"; accountQuotaVerified: false }>;
/** 고유 진단 객체만 생성·검증·정리합니다. D1 학습 자료 등록과 AI 호출은 실행하지 않습니다. */
export async function probePdfContent(request: Request, bucket: R2Bucket, metadata: MaterialMetadata, compiled: WebAssembly.Module): Promise<PdfProbeProof> {
  if (request.body === null) throw materialFailure("material_body_length_invalid", "body", 400);
  const key: string = `diagnostics/material-pdf/${crypto.randomUUID()}`;
  const upload: R2MultipartUpload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: "application/pdf" } });
  let completed: boolean = false;
  try {
    const bridge: FixedLengthStream = new FixedLengthStream(metadata.bytes);
    const stop: AbortController = new AbortController();
    const signal: AbortSignal = AbortSignal.any([request.signal, stop.signal, AbortSignal.timeout(60000)]);
    const outcomes = await Promise.allSettled([
      transferMaterialBytes(request.body, bridge.writable, metadata, signal),
      upload.uploadPart(1, bridge.readable).catch((error: unknown): never => { stop.abort(error); throw error; }),
    ]);
    const [transfer, part] = outcomes;
    if (transfer.status === "rejected") throw transfer.reason;
    if (part.status === "rejected") throw part.reason;
    const saved: R2Object = await upload.complete([part.value]);
    completed = true;
    if (saved.size !== metadata.bytes) throw materialFailure("material_storage_unavailable", "pdf:stored-size-mismatch", 503);
    const pdf: PdfStructureProof = await validatePdfStructure(pdfR2Source(bucket, key, saved), signal, compiled);
    await deletePrivateObject(bucket, key);
    return { checkedAt: new Date().toISOString(), transfer: transfer.value, pdf, cleanup: "passed", accountQuotaVerified: false };
  } catch (error: unknown) {
    try {
      if (!completed) await upload.abort();
      await deletePrivateObject(bucket, key);
    } catch (cleanupError: unknown) {
      console.warn({ event: "pdf_probe_cleanup_unconfirmed", key, uploadId: upload.uploadId, completed, replayAllowed: false });
      throw new AggregateError([error, cleanupError], "PDF 진단 실패 후 임시 객체 정리가 확인되지 않았습니다. 진단 키와 multipart 상태를 대사해야 합니다.");
    }
    throw error;
  }
}
