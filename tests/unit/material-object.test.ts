import { describe, expect, it } from "vitest";
import { requireMaterialObject } from "../../lib/materials/object";
import type { MaterialObjectIdentity } from "../../lib/materials/object";
import type { StoredTransfer } from "../../db/repositories/material-transfers";

const transfer: StoredTransfer = { id: "transfer", materialId: "material", uploadId: "upload", objectKey: "learning/material/upload/transfer", version: 4, courseId: "course", reservedAt: 0, metadata: { title: "교재", edition: "", kind: "text", role: "reference", mime: "text/plain", filename: "교재.txt", bytes: 10, sha256: "a".repeat(64) }, snapshot: { state: "stored", writeStatus: "succeeded", multipartId: "multipart", object: { objectVersion: "v1", etag: "e1", sha256: "a".repeat(64), bytes: 10 }, validation: null, failureCode: null, updatedAt: 1 } };
const object: MaterialObjectIdentity = { key: transfer.objectKey, version: "v1", etag: "e1", size: 10, httpMetadata: { contentType: "text/plain" }, customMetadata: { alterTransferId: "transfer", alterUploadId: "upload", alterMaterialId: "material", alterSha256: "a".repeat(64) } };
describe("자료 객체의 정확한 소유 시도·버전 대조", (): void => {
  it("저장한 시도와 일치하는 객체를 허용한다", (): void => { expect(() => requireMaterialObject(object, transfer)).not.toThrow(); });
  it("키·버전·etag·크기·MIME 변경을 거부한다", (): void => {
    for (const changed of [{ ...object, key: "other" }, { ...object, version: "v2" }, { ...object, etag: "e2" }, { ...object, size: 11 }, { ...object, httpMetadata: { contentType: "image/png" } }]) expect(() => requireMaterialObject(changed, transfer)).toThrow();
  });
  it("서버 식별자·해시 메타데이터 누락이나 변경을 거부한다", (): void => {
    for (const field of ["alterTransferId", "alterUploadId", "alterMaterialId", "alterSha256"]) expect(() => requireMaterialObject({ ...object, customMetadata: { ...object.customMetadata, [field]: "wrong" } }, transfer)).toThrow();
    expect(() => requireMaterialObject({ ...object, customMetadata: undefined }, transfer)).toThrow();
  });
  it("R2 저장 사실이 없는 상태의 내용 검증을 거부한다", (): void => { expect(() => requireMaterialObject(object, { ...transfer, snapshot: { ...transfer.snapshot, object: null } })).toThrow(); });
});
