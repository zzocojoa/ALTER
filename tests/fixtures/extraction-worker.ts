import pdf from "../../lib/materials/pdf-wasm/validator.wasm";
import jpeg from "../../lib/materials/jpeg-wasm/decoder.wasm";
import { initializeUploadFixture } from "./material-transfer-setup";
import { uploadMaterialBody } from "../../lib/materials/upload";
import { completeMaterialTransfer } from "../../lib/materials/complete";
import { getMaterialTransfer } from "../../db/repositories/material-transfers";
import { getExtractionJob, saveExtractionSelection } from "../../db/repositories/extraction-jobs";
import { materialFileReference } from "../../lib/materials/attachment";
import { buildSelection } from "../../lib/extraction/selection";
import { requireExtractionImage, requireExtractionPage } from "../../lib/extraction/server";
import { boundedImageGeometry } from "../../lib/extraction/image";

async function fetch(request: Request, environment: Readonly<{ DB: D1Database; BUCKET: R2Bucket }>): Promise<Response> {
  const { DB, BUCKET } = environment;
  const fault: string = request.headers.get("x-extraction-fault") ?? "none";
  const { owner, id } = await initializeUploadFixture(DB, request);
  const uploaded = await uploadMaterialBody(DB, BUCKET, owner, id, 1, request);
  if (fault === "unverified") {
    const pending = await getMaterialTransfer(DB, owner, id);
    try { await requireExtractionPage(DB, BUCKET, owner, pending.materialId, 1, 1); return Response.json({ accepted: true }); }
    catch (error: unknown) { return Response.json({ accepted: false, code: error instanceof Error && "code" in error ? error.code : null }, { status: error instanceof Error && "status" in error ? Number(error.status) : 500 }); }
  }
  await completeMaterialTransfer(DB, BUCKET, owner, id, uploaded.version, { pdf, jpeg }, new AbortController().signal);
  const transfer = await getMaterialTransfer(DB, owner, id);
  const selection = buildSelection(materialFileReference(transfer), "", "1");
  const command = { owner, expectedVersion: 0, requestKey: crypto.randomUUID() };
  const first = await saveExtractionSelection(DB, command, transfer, selection);
  const repeated = await saveExtractionSelection(DB, command, transfer, selection);
  if (JSON.stringify(first) !== JSON.stringify(repeated)) throw new Error("선택 재전송 결과가 달라요.");
  try {
    if (fault === "stale-selection") await saveExtractionSelection(DB, { ...command, expectedVersion: 1, requestKey: crypto.randomUUID() }, transfer, selection);
    if (fault === "missing") await BUCKET.delete(transfer.objectKey);
    if (fault === "changed-original") {
      const original = await BUCKET.get(transfer.objectKey); if (original === null) throw new Error("검사 원본이 없어요.");
      await BUCKET.put(transfer.objectKey, original.body, { httpMetadata: original.httpMetadata, customMetadata: original.customMetadata });
    }
    const page = await requireExtractionPage(DB, BUCKET, fault === "other-owner" ? { realm: "sites", userId: "other" } : owner, fault === "forged-id" ? crypto.randomUUID() : transfer.materialId, 1, fault === "unselected" ? 2 : 1);
    const original = await BUCKET.get(transfer.objectKey); if (original === null) throw new Error("검사 원본이 없어요.");
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await original.arrayBuffer());
    const view: DataView = new DataView(bytes.buffer);
    const width: number = view.getUint32(16); const height: number = view.getUint32(20);
    const geometry = boundedImageGeometry(fault === "dimensions" ? width + 1 : width, height, 0);
    const image = { dataUrl: `data:image/png;base64,${btoa(Array.from(bytes, (value: number): string => String.fromCharCode(value)).join(""))}`, mime: "image/png", bytes: bytes.length + (fault === "bytes" ? 1 : 0), sha256: fault === "hash" ? "a".repeat(64) : transfer.metadata.sha256, ...geometry, sourceWidth: fault === "dimensions" ? width + 1 : width, sourceHeight: height, rotation: 0, coordinateSpace: "decoded-image" };
    const result = await requireExtractionImage(page, fault === "coordinate" ? { ...image, sourceToImage: [1, 0, 0, 1, 999, 0] } : fault === "mime" ? { ...image, mime: "image/jpeg" } : image, new AbortController().signal);
    const job = await getExtractionJob(DB, owner, transfer.materialId);
    return Response.json({ accepted: true, imageBytes: result.bytes, selectedPages: job?.selection.pages.map((entry): number => entry.filePage), revision: job?.revision, idempotent: true });
  } catch (error: unknown) {
    return Response.json({ accepted: false, type: error instanceof Error ? error.name : "unknown", code: error instanceof Error && "code" in error ? error.code : null, field: error instanceof Error && "field" in error ? error.field : null }, { status: error instanceof Error && "status" in error ? Number(error.status) : 400 });
  }
}
const worker = { fetch };
export default worker;
