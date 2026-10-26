import { readGoogleMaterialSource } from "../../db/repositories/google-references.ts";
import type { GoogleReferenceProof } from "../google-reference/contract.ts";
import { z } from "zod";
import type { SiteIdentity } from "../domain/contracts.ts";
import { readStorage } from "../../db/repositories/atomic.ts";
import { getMaterialTransfer, getMaterialUsage } from "../../db/repositories/material-transfers.ts";
import type { MaterialUsage } from "../../db/repositories/material-transfers.ts";
import { materialMetadata } from "./policy.ts";
import type { MaterialMetadata } from "./policy.ts";
import { materialFileReference } from "./attachment.ts";
import type { MaterialFileReference } from "./attachment.ts";
import { transferState } from "./transfer-state.ts";

export type MaterialCard = Readonly<{ id: string; courseId: string; metadata: MaterialMetadata; file: MaterialFileReference;googleSource?:GoogleReferenceProof|null }>;
export type PendingMaterial = Readonly<{ id: string; materialId: string; version: number; state: z.infer<typeof transferState>; metadata: MaterialMetadata }>;
export type MaterialLibrary = Readonly<{ materials: readonly MaterialCard[]; courses: readonly Readonly<{ id: string; title: string }>[]; pending: readonly PendingMaterial[]; usage: MaterialUsage | null; hidden: boolean; hasMore: boolean; cursor: string | null }>;

/** 화면에는 검증된 파일 참조와 미확정 시도만 반환하고 저장소 키는 제외합니다. */
export async function readMaterialLibrary(db: D1Database, owner: SiteIdentity, cursor: string | null): Promise<MaterialLibrary> {
  const after: string = cursor === null ? "" : z.string().uuid().parse(cursor);
  const [files, courses, unfinished, inventory, hidden] = await Promise.all([
    readStorage("material.library.files", () => db.prepare("SELECT transfer_id FROM material_files WHERE owner_id=? AND (?='' OR rowid < (SELECT rowid FROM material_files WHERE owner_id=? AND material_id=?)) ORDER BY rowid DESC LIMIT 51").bind(owner.userId, after, owner.userId, after).all<{ transfer_id: string }>()),
    readStorage("material.library.courses", () => db.prepare("SELECT id,title FROM courses WHERE owner_id=? ORDER BY title,id").bind(owner.userId).all<{ id: string; title: string }>()),
    readStorage("material.library.pending", () => db.prepare("SELECT id,material_id,version,state,metadata FROM material_transfers WHERE owner_id=? AND state NOT IN ('registered','discarded') ORDER BY updated_at").bind(owner.userId).all<{ id: string; material_id: string; version: number; state: string; metadata: string }>()),
    readStorage("material.library.inventory", () => db.prepare("SELECT COUNT(*) AS n FROM material_inventory WHERE owner_id=?").bind(owner.userId).first<number>("n")),
    readStorage("material.library.hidden", () => db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE owner_id=? AND status='awaiting-answer' AND hidden_material=1").bind(owner.userId).first<number>("n")),
  ]);
  const materials: readonly MaterialCard[] = await Promise.all(files.results.slice(0, 50).map(async (row): Promise<MaterialCard> => { const transfer = await getMaterialTransfer(db, owner, row.transfer_id); return { id: transfer.materialId, courseId: transfer.courseId, metadata: transfer.metadata, file: materialFileReference(transfer),googleSource:await readGoogleMaterialSource(db,owner,transfer.materialId) }; }));
  return { materials, courses: courses.results, pending: unfinished.results.map((row): PendingMaterial => ({ id: row.id, materialId: row.material_id, version: row.version, state: transferState.parse(row.state), metadata: materialMetadata.parse(JSON.parse(row.metadata)) })), usage: inventory === 0 ? null : await getMaterialUsage(db, owner), hidden: hidden !== 0, hasMore: files.results.length > 50, cursor: materials.at(-1)?.id ?? null };
}
