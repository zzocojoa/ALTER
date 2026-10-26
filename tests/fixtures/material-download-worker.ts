import pdf from "../../lib/materials/pdf-wasm/validator.wasm";
import jpeg from "../../lib/materials/jpeg-wasm/decoder.wasm";
import { completeMaterialTransfer } from "../../lib/materials/complete";
import { getRegisteredMaterial, headMaterialFile, readMaterialFile, materialFileHeaders } from "../../lib/materials/download";
import { uploadMaterialBody } from "../../lib/materials/upload";
import { getMaterialTransfer } from "../../db/repositories/material-transfers";
import { initializeUploadFixture } from "./material-transfer-setup";

async function fetch(request: Request, environment: Readonly<{ DB: D1Database; BUCKET: R2Bucket }>): Promise<Response> {
  const { DB, BUCKET } = environment;
  if (request.method === "GET") {
    const transfer = await getRegisteredMaterial(DB, { realm: "sites", userId: request.headers.get("x-fixture-owner") ?? "" }, request.headers.get("x-fixture-material") ?? "");
    return readMaterialFile(BUCKET, transfer, request, "inline");
  }
  if (request.method === "HEAD") {
    const transfer = await getRegisteredMaterial(DB, { realm: "sites", userId: request.headers.get("x-fixture-owner") ?? "" }, request.headers.get("x-fixture-material") ?? "");
    return headMaterialFile(BUCKET, transfer, "inline");
  }
  const { owner, id } = await initializeUploadFixture(DB, request);
  const uploaded = await uploadMaterialBody(DB, BUCKET, owner, id, 1, request);
  const fault: string = request.headers.get("x-fixture-fault") ?? "none";
  if (fault !== "unregistered") await completeMaterialTransfer(DB, BUCKET, owner, id, uploaded.version, { pdf, jpeg }, new AbortController().signal);
  const stored = await getMaterialTransfer(DB, owner, id);
  if (fault === "missing") await BUCKET.delete(stored.objectKey);
  if (fault === "changed-version") {
    const original = await BUCKET.get(stored.objectKey);
    if (original === null) throw new Error("fixture object missing");
    await BUCKET.put(stored.objectKey, original.body, { httpMetadata: original.httpMetadata, customMetadata: original.customMetadata });
  }
  let response: Response;
  try {
    const transfer = await getRegisteredMaterial(DB, fault === "foreign-owner" ? { ...owner, userId: "other" } : owner, fault === "raw-key" ? stored.objectKey : stored.materialId);
    const headers: Headers = new Headers();
    const range: string | null = request.headers.get("x-fixture-range");
    if (range !== null) headers.set("range", range);
    const ifRange: string | null = request.headers.get("x-fixture-if-range");
    if (ifRange !== null) headers.set("if-range", ifRange === "matching" ? materialFileHeaders(transfer, "inline").get("etag")! : '"stale"');
    if (fault === "stale-if-match") headers.set("if-match", '"stale"');
    if (fault === "matching-if-match") headers.set("if-match", materialFileHeaders(transfer, "inline").get("etag")!);
    const readRequest = new Request("https://local.invalid/file", { headers });
    response = await readMaterialFile(BUCKET, transfer, readRequest, "inline");
  } catch (error: unknown) {
    response = Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof Error && "status" in error ? Number(error.status) : 400 });
  }
  response.headers.set("x-fixture-key", stored.objectKey);
  response.headers.set("x-fixture-owner", owner.userId);
  response.headers.set("x-fixture-material", stored.materialId);
  return response;
}
const worker = { fetch };
export default worker;
