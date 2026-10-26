import { recordId } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { readStorage } from "../../db/repositories/atomic.ts";
import { getMaterialTransfer } from "../../db/repositories/material-transfers.ts";
import type { StoredTransfer } from "../../db/repositories/material-transfers.ts";
import { materialFailure } from "./policy.ts";
import { headMaterialObject, requireMaterialObject } from "./object.ts";
import { parseMaterialRange } from "./range.ts";
import type { MaterialRangeResult } from "./range.ts";

export type MaterialDisposition = "inline" | "attachment";

/** 확정 연결과 소유권을 먼저 읽으며 클라이언트가 R2 키를 선택하지 못하게 합니다. */
export async function getRegisteredMaterial(db: D1Database, owner: SiteIdentity, materialId: string): Promise<StoredTransfer> {
  recordId.parse(materialId);
  const id: string | null = await readStorage("material.file.get", () => db.prepare("SELECT f.transfer_id FROM material_files f JOIN material_transfers t ON t.owner_id=f.owner_id AND t.id=f.transfer_id JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE f.owner_id=? AND f.material_id=? AND t.state='registered' AND u.state='verified'").bind(owner.userId, materialId).first<string>("transfer_id"));
  if (id === null) throw materialFailure("material_access_required", "registered-material-not-found", 404);
  const transfer: StoredTransfer = await getMaterialTransfer(db, owner, id);
  if (transfer.materialId !== materialId || transfer.snapshot.validation === null) throw materialFailure("material_storage_unavailable", "registered-material-inconsistent", 409);
  return transfer;
}

/** 검증된 객체 버전을 강한 ETag로 사용하고 비공개 원본의 캐시·스크립트 해석을 막습니다. */
export function materialFileHeaders(transfer: StoredTransfer, disposition: MaterialDisposition): Headers {
  const object = transfer.snapshot.object;
  if (object === null) throw materialFailure("material_storage_unavailable", "stored-object-fact-missing", 409);
  const extension: string = transfer.metadata.mime === "application/pdf" ? "pdf" : transfer.metadata.mime === "image/png" ? "png" : transfer.metadata.mime === "image/jpeg" ? "jpg" : "txt";
  const encodedName: string = encodeURIComponent(transfer.metadata.filename).replace(/['()*]/g, (character: string): string => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Headers({
    "Cache-Control": "private, no-store, no-transform", "Vary": "Cookie, Authorization", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes",
    "Content-Type": transfer.metadata.mime === "text/plain" ? "text/plain; charset=utf-8" : transfer.metadata.mime,
    "Content-Length": String(transfer.metadata.bytes),
    "Content-Disposition": `${disposition}; filename="material.${extension}"; filename*=UTF-8''${encodedName}`,
    "ETag": `"${encodeURIComponent(object.objectVersion)}.${object.etag}"`,
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
}

export async function headMaterialFile(bucket: R2Bucket, transfer: StoredTransfer, disposition: MaterialDisposition): Promise<Response> {
  await headMaterialObject(bucket, transfer);
  return new Response(null, { status: 200, headers: materialFileHeaders(transfer, disposition) });
}

/** R2가 반환한 동일 버전의 본문을 직접 반환하며 전체 원본을 버퍼링하지 않습니다. */
export async function readMaterialFile(bucket: R2Bucket, transfer: StoredTransfer, request: Readonly<Pick<Request, "headers" | "signal">>, disposition: MaterialDisposition): Promise<Response> {
  await headMaterialObject(bucket, transfer);
  const headers: Headers = materialFileHeaders(transfer, disposition);
  const ifMatch: string | null = request.headers.get("if-match");
  if (ifMatch !== null && ifMatch !== headers.get("etag")) return new Response(null, { status: 412, headers: { "Cache-Control": "private, no-store" } });
  const ifRange: string | null = request.headers.get("if-range");
  const selection: MaterialRangeResult = parseMaterialRange(ifRange !== null && ifRange !== headers.get("etag") ? null : request.headers.get("range"), transfer.metadata.bytes);
  if (selection.kind === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${transfer.metadata.bytes}`); headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }
  const saved = transfer.snapshot.object;
  if (saved === null) throw materialFailure("material_storage_unavailable", "stored-object-fact-missing", 409);
  const object: R2ObjectBody | R2Object | null = await readStorage("material.file.read", () => bucket.get(transfer.objectKey, { onlyIf: { etagMatches: saved.etag }, ...(selection.kind === "range" ? { range: selection.range } : {}) }));
  if (object === null || !("body" in object)) throw materialFailure("material_storage_unavailable", "object-missing-or-changed", 409);
  try {
    requireMaterialObject(object, transfer);
    if (selection.kind === "range" && (object.range === undefined || !("offset" in object.range) || !("length" in object.range) || object.range.offset !== selection.range.offset || object.range.length !== selection.range.length)) throw materialFailure("material_storage_unavailable", "range-response-mismatch", 409);
    request.signal.throwIfAborted();
  } catch (error: unknown) { await object.body.cancel(error); throw error; }
  if (selection.kind === "range") {
    const { offset, length } = selection.range;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${transfer.metadata.bytes}`); headers.set("Content-Length", String(length));
  }
  return new Response(object.body, { status: selection.kind === "range" ? 206 : 200, headers });
}
