import pdf from "../../lib/materials/pdf-wasm/validator.wasm";
import jpeg from "../../lib/materials/jpeg-wasm/decoder.wasm";
import { completeMaterialTransfer } from "../../lib/materials/complete";
import { uploadMaterialBody } from "../../lib/materials/upload";
import { getMaterialTransfer, getMaterialUsage } from "../../db/repositories/material-transfers";
import { initializeUploadFixture } from "./material-transfer-setup";

async function fetch(request: Request, environment: Readonly<{ DB: D1Database; BUCKET: R2Bucket }>): Promise<Response> {
  const { owner, id } = await initializeUploadFixture(environment.DB, request);
  const uploaded = await uploadMaterialBody(environment.DB, environment.BUCKET, owner, id, 1, request);
  const before = await getMaterialTransfer(environment.DB, owner, id);
  const fault: string | null = request.headers.get("x-fixture-fault");
  if (fault === "missing") await environment.BUCKET.delete(before.objectKey);
  if (fault === "changed-version") {
    const original: R2ObjectBody | null = await environment.BUCKET.get(before.objectKey);
    if (original === null) throw new Error("fixture object missing");
    await environment.BUCKET.put(before.objectKey, original.body, { httpMetadata: original.httpMetadata, customMetadata: original.customMetadata });
  }
  if (fault === "inventory-block") await environment.DB.prepare("UPDATE material_inventory SET blocked=1 WHERE owner_id=?").bind(owner.userId).run();
  let result: unknown;
  let status: number = 200;
  let idempotent: boolean = false;
  try {
    if (fault === "concurrent") {
      const outcomes = await Promise.allSettled([0, 1].map(() => completeMaterialTransfer(environment.DB, environment.BUCKET, owner, id, uploaded.version, { pdf, jpeg }, new AbortController().signal)));
      const accepted = outcomes.find((outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof completeMaterialTransfer>>> => outcome.status === "fulfilled");
      if (accepted === undefined) throw new Error("concurrent completion failed");
      result = accepted.value;
    } else result = await completeMaterialTransfer(environment.DB, environment.BUCKET, owner, id, uploaded.version, { pdf, jpeg }, new AbortController().signal);
    const replay = await completeMaterialTransfer(environment.DB, environment.BUCKET, owner, id, uploaded.version, { pdf, jpeg }, new AbortController().signal);
    idempotent = replay.materialId === uploaded.materialId;
  } catch (error: unknown) { status = error instanceof Error && "status" in error ? Number(error.status) : 503; result = { message: error instanceof Error ? error.message : String(error) }; }
  const after = await getMaterialTransfer(environment.DB, owner, id);
  const usage = await getMaterialUsage(environment.DB, owner);
  const registered: number | null = await environment.DB.prepare("SELECT COUNT(*) AS n FROM material_files WHERE owner_id=?").bind(owner.userId).first<number>("n");
  return Response.json({ result, state: after.snapshot, usage, idempotent, registered, objectKey: after.objectKey, storedBytes: before.metadata.bytes }, { status });
}
const worker = { fetch };
export default worker;
