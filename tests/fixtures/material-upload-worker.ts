import { getMaterialTransfer, getMaterialUsage } from "../../db/repositories/material-transfers";
import { uploadMaterialBody } from "../../lib/materials/upload";
import type { MaterialUploadBucket } from "../../lib/materials/upload";
import { initializeUploadFixture } from "./material-transfer-setup";

function faultBucket(bucket: R2Bucket, fault: string, stop: AbortController): MaterialUploadBucket {
  return { async createMultipartUpload(key: string, options: R2MultipartOptions): Promise<R2MultipartUpload> {
    const upload: R2MultipartUpload = await bucket.createMultipartUpload(key, options);
    if (fault === "create-response-loss") throw new Error("synthetic create response lost");
    return { key: upload.key, uploadId: upload.uploadId,
      async uploadPart(part: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob, options: R2UploadPartOptions): Promise<R2UploadedPart> {
        if (fault === "client-abort") stop.abort(new DOMException("synthetic client abort", "AbortError"));
        if (fault === "part-failure") throw new Error("synthetic part rejected");
        return upload.uploadPart(part, value, options);
      },
      async complete(parts: R2UploadedPart[]): Promise<R2Object> {
        const object: R2Object = await upload.complete(parts);
        if (fault === "complete-response-loss") throw new Error("synthetic complete response lost");
        return object;
      },
      async abort(): Promise<void> { await upload.abort(); },
    };
  } };
}

async function fetch(request: Request, environment: Readonly<{ DB: D1Database; BUCKET: R2Bucket }>): Promise<Response> {
  const { owner, id } = await initializeUploadFixture(environment.DB, request);
  let result: unknown;
  let status: number = 200;
  const stop: AbortController = new AbortController();
  const fault: string = request.headers.get("x-fixture-fault") ?? "none";
  const input: Request = new Request(request, { signal: stop.signal });
  try {
    if (fault === "concurrent") {
      const duplicate: ReturnType<typeof input.clone> = input.clone();
      const results = await Promise.allSettled([uploadMaterialBody(environment.DB, faultBucket(environment.BUCKET, fault, stop), owner, id, 1, input), uploadMaterialBody(environment.DB, faultBucket(environment.BUCKET, fault, stop), owner, id, 1, duplicate)]);
      const successes = results.filter((entry): entry is PromiseFulfilledResult<Awaited<ReturnType<typeof uploadMaterialBody>>> => entry.status === "fulfilled");
      if (successes.length !== 1) throw new Error("concurrent upload did not have one winner");
      result = successes[0].value;
    } else result = await uploadMaterialBody(environment.DB, faultBucket(environment.BUCKET, fault, stop), owner, id, 1, input);
  }
  catch (error: unknown) { status = error instanceof Error && "status" in error ? Number(error.status) : 503; result = { message: error instanceof Error ? error.message : String(error) }; }
  const transfer = await getMaterialTransfer(environment.DB, owner, id);
  const usage = await getMaterialUsage(environment.DB, owner);
  const object = await environment.BUCKET.head(transfer.objectKey);
  return Response.json({ result, state: transfer.snapshot, version: transfer.version, usage, object: object === null ? null : { key: object.key, size: object.size, version: object.version, metadata: object.customMetadata } }, { status });
}
const worker = { fetch };
export default worker;
