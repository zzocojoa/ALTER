import pdf from "../../lib/materials/pdf-wasm/validator.wasm";
import jpeg from "../../lib/materials/jpeg-wasm/decoder.wasm";
import { recoverMaterialTransfer, cleanupMaterialTransfer } from "../../lib/materials/recovery";
import { completeMaterialTransfer } from "../../lib/materials/complete";
import { uploadMaterialBody } from "../../lib/materials/upload";
import { transitionMaterialTransfer } from "../../lib/materials/transition";
import { getMaterialTransfer, getMaterialUsage } from "../../db/repositories/material-transfers";
import { initializeUploadFixture } from "./material-transfer-setup";
import { materialFailure } from "../../lib/materials/policy";

function faultBucket(bucket: R2Bucket, fault: string): R2Bucket {
  return new Proxy(bucket, { get(target: R2Bucket, property: string | symbol): unknown {
    if (property === "delete" && fault === "delete-response-loss") return async (key: string): Promise<void> => { await target.delete(key); throw new Error("injected-delete-response-loss"); };
    if (property === "delete" && fault === "delete-failure") return async (): Promise<void> => { throw new Error("injected-delete-failure"); };
    if (property === "resumeMultipartUpload" && fault === "abort-unconfirmed") return (key: string, uploadId: string): R2MultipartUpload => ({ ...target.resumeMultipartUpload(key, uploadId), abort: async (): Promise<void> => { throw new Error("injected-abort-unconfirmed"); } });
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

async function fetch(request: Request, environment: Readonly<{ DB: D1Database; BUCKET: R2Bucket }>): Promise<Response> {
  const { DB, BUCKET } = environment;
  const { owner, id } = await initializeUploadFixture(DB, request);
  const scenario: string = request.headers.get("x-fixture-fault") ?? "reserved";
  let current = await getMaterialTransfer(DB, owner, id);
  let multipart: R2MultipartUpload | null = null;
  let part: R2UploadedPart | null = null;
  let fenced: boolean = false;
  const signal: AbortSignal = new AbortController().signal;
  if (["no-multipart", "create-response-loss", "incomplete-part", "complete-response-loss", "abort-unconfirmed", "late-complete"].includes(scenario)) {
    current = await transitionMaterialTransfer(DB, owner, current, { type: "start" }, crypto.randomUUID());
    if (scenario !== "no-multipart") multipart = await BUCKET.createMultipartUpload(current.objectKey, { httpMetadata: { contentType: current.metadata.mime }, customMetadata: { alterTransferId: id, alterUploadId: current.uploadId, alterMaterialId: current.materialId, alterSha256: current.metadata.sha256 } });
    if (multipart !== null && scenario !== "create-response-loss") {
      current = await transitionMaterialTransfer(DB, owner, current, { type: "multipart-created", multipartId: multipart.uploadId }, crypto.randomUUID());
      if (request.body === null) throw new Error("fixture body missing");
      part = await multipart.uploadPart(1, request.body);
      if (scenario === "complete-response-loss") await multipart.complete([part]);
    }
    current = await transitionMaterialTransfer(DB, owner, current, { type: "write-unknown", reason: "injected-interruption" }, crypto.randomUUID());
  } else if (scenario !== "reserved") {
    await uploadMaterialBody(DB, BUCKET, owner, id, current.version, request);
    current = await getMaterialTransfer(DB, owner, id);
    if (scenario.startsWith("failed-jpeg") || scenario.startsWith("failed-pdf")) {
      current = await transitionMaterialTransfer(DB, owner, current, { type: "validate" }, crypto.randomUUID());
      current = await transitionMaterialTransfer(DB, owner, current, { type: "content-failed", reason: scenario.startsWith("failed-pdf") ? "material_content_invalid:pdf:stream-decode-failed" : "content-or-object-invalid" }, crypto.randomUUID());
    }
    if (scenario === "registered") {
      await completeMaterialTransfer(DB, BUCKET, owner, id, current.version, { pdf, jpeg }, signal);
      current = await getMaterialTransfer(DB, owner, id);
    }
    if (scenario === "changed-version") {
      const original = await BUCKET.get(current.objectKey);
      if (original === null) throw new Error("fixture object missing");
      await BUCKET.put(current.objectKey, original.body, { httpMetadata: original.httpMetadata, customMetadata: original.customMetadata });
    }
    if (scenario === "d1-after-delete") await DB.prepare("CREATE TRIGGER fixture_fail_deleted BEFORE UPDATE ON material_transfers WHEN NEW.state='discarded' BEGIN SELECT RAISE(ABORT,'injected deleted-state failure'); END").run();
  }
  let result: unknown = null;
  let firstError: string | null = null;
  let interrupted: Readonly<{ state: string; reservedBytes: number; objectExists: boolean }> | null = null;
  try {
    if (scenario === "concurrent") {
      const outcomes = await Promise.allSettled([recoverMaterialTransfer(DB, BUCKET, owner, id, current.version, { pdf, jpeg }, signal), completeMaterialTransfer(DB, BUCKET, owner, id, current.version, { pdf, jpeg }, signal)]);
      if (outcomes.every((outcome): boolean => outcome.status === "rejected")) throw new Error("all concurrent requests failed");
      result = { successes: outcomes.filter((outcome): boolean => outcome.status === "fulfilled").length };
    } else if (["registered", "foreign-owner", "changed-version", "delete-response-loss", "delete-failure", "d1-after-delete"].includes(scenario)) {
      result = await cleanupMaterialTransfer(DB, faultBucket(BUCKET, scenario), scenario === "foreign-owner" ? { ...owner, userId: "other-owner" } : owner, id, current.version, signal);
    } else {
      result = await recoverMaterialTransfer(DB, faultBucket(BUCKET, scenario), owner, id, ["failed-jpeg-stale", "failed-pdf-stale"].includes(scenario) ? current.version - 1 : current.version, { pdf, jpeg }, signal);
      current = await getMaterialTransfer(DB, owner, id);
      if (["no-multipart", "create-response-loss"].includes(scenario)) {
        try { await transitionMaterialTransfer(DB, owner, current, { type: "multipart-created", multipartId: multipart?.uploadId ?? "late" }, crypto.randomUUID()); }
        catch (error: unknown) { if (!(error instanceof Error)) throw error; fenced = true; }
      }
      if (current.snapshot.state !== "registered") result = await cleanupMaterialTransfer(DB, BUCKET, owner, id, current.version, signal);
      if (scenario === "late-complete" && multipart !== null && part !== null) {
        try { await multipart.complete([part]); }
        catch (error: unknown) { if (!(error instanceof Error)) throw error; fenced = true; }
      }
    }
  } catch (error: unknown) {
    firstError = error instanceof Error ? error.message : String(error);
    current = await getMaterialTransfer(DB, owner, id);
    interrupted = { state: current.snapshot.state, reservedBytes: (await getMaterialUsage(DB, owner)).reservedBytes, objectExists: await BUCKET.head(current.objectKey) !== null };
    if (scenario === "d1-after-delete") await DB.prepare("DROP TRIGGER fixture_fail_deleted").run();
    if (["d1-after-delete", "delete-failure", "abort-unconfirmed"].includes(scenario)) result = await cleanupMaterialTransfer(DB, BUCKET, owner, id, current.version, signal);
    else if (!["registered", "foreign-owner", "changed-version", "failed-jpeg-invalid", "failed-jpeg-stale", "failed-pdf-invalid", "failed-pdf-stale"].includes(scenario)) throw materialFailure("material_storage_unavailable", firstError, 503);
  }
  current = await getMaterialTransfer(DB, owner, id);
  const replay = current.snapshot.state === "discarded" ? await cleanupMaterialTransfer(DB, BUCKET, owner, id, 1, signal) : null;
  return Response.json({ result, firstError, interrupted, fenced, replay: replay?.state ?? null, state: current.snapshot.state, failureCode: current.snapshot.failureCode, usage: await getMaterialUsage(DB, owner), objectExists: await BUCKET.head(current.objectKey) !== null, objectKey: current.objectKey, registered: await DB.prepare("SELECT COUNT(*) AS n FROM material_files WHERE owner_id=?").bind(owner.userId).first<number>("n") });
}
const worker = { fetch };
export default worker;
