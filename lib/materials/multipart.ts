/** 같은 multipart 중단만 재시도하며 완료·객체 존재 여부는 호출자가 다시 대조합니다. */
export async function abortMaterialMultipart(upload: R2MultipartUpload): Promise<void> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try { await upload.abort(); return; }
    catch (error: unknown) {
      if (attempt === 3) throw error;
      console.warn({ event: "material_multipart_abort_retry", uploadId: upload.uploadId, attempt, errorType: error instanceof Error ? error.name : "unknown" });
      await new Promise<void>((resolve): void => { setTimeout(resolve, attempt * 100); });
    }
  }
}
