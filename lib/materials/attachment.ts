import { materialFailure } from "./policy.ts";
import type { MaterialKind, MaterialRole } from "./policy.ts";
import type { StoredTransfer } from "../../db/repositories/material-transfers.ts";

export type MaterialFileReference = Readonly<{ materialId: string; kind: MaterialKind; role: MaterialRole; bytes: number; pages: number; sha256: string; objectVersion: string; sourceUrl: string }>;

/** 교재 역할과 답안 연결은 이 공통 검증 원본 참조를 사용하고 R2 키를 외부로 내보내지 않습니다. */
export function materialFileReference(transfer: StoredTransfer): MaterialFileReference {
  if (transfer.snapshot.state !== "registered" || transfer.snapshot.validation === null) throw materialFailure("material_access_required", "file-not-registered", 409);
  return { materialId: transfer.materialId, kind: transfer.metadata.kind, role: transfer.metadata.role, bytes: transfer.metadata.bytes, pages: transfer.snapshot.validation.pages, sha256: transfer.metadata.sha256, objectVersion: transfer.snapshot.validation.objectVersion, sourceUrl: `/api/materials/${transfer.materialId}/file` };
}
