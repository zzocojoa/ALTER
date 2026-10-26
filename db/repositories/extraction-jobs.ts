import { selectionInput, validateSelection } from "../../lib/extraction/selection.ts";
import type { SelectionInput, SelectionBinding } from "../../lib/extraction/selection.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { recordId } from "../../lib/domain/contracts.ts";
import { materialFileReference } from "../../lib/materials/attachment.ts";
import type { StoredTransfer } from "./material-transfers.ts";
import { executeAtomic, guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

export type ExtractionJob = SelectionBinding & Readonly<{ uploadId: string }>;
type StoredJob = Readonly<{ id: string; version: number; upload_id: string; selection: string }>;
export async function getExtractionJob(db: D1Database, owner: SiteIdentity, materialId: string): Promise<ExtractionJob | null> {
  recordId.parse(materialId);
  const row: StoredJob | null = await readStorage("extraction.job.read", () => db.prepare("SELECT id,version,upload_id,selection FROM extraction_jobs WHERE owner_id=? AND id=?").bind(owner.userId, materialId).first<StoredJob>());
  return row === null ? null : { jobId: row.id, revision: row.version, uploadId: row.upload_id, selection: selectionInput.parse(JSON.parse(row.selection)) };
}

/** 저장 직전에도 등록 원본과 선택을 대조하며 동시 선택 변경은 원자적으로 실패합니다. */
export async function saveExtractionSelection(db: D1Database, context: Command, transfer: StoredTransfer, value: SelectionInput): Promise<Receipt> {
  const selection: SelectionInput = validateSelection(value, materialFileReference(transfer));
  if (!Number.isSafeInteger(context.expectedVersion) || context.expectedVersion < 0) throw new RangeError("선택 버전이 올바르지 않습니다.");
  const payload = { selection, uploadId: transfer.id, previousRevision: context.expectedVersion };
  return executeAtomic(db, { ...context, expectedVersion: Math.max(1, context.expectedVersion) }, "extraction.selection", payload, selection.materialId, context.expectedVersion + 1, (requestId: string) => [
    requireInBatch(db, context.owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM material_files f JOIN material_transfers t ON t.owner_id=f.owner_id AND t.id=f.transfer_id JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE f.owner_id=? AND f.material_id=? AND t.id=? AND t.state='registered' AND u.state='verified' AND t.object_version=? AND t.actual_hash=?)", [context.owner.userId, selection.materialId, transfer.id, selection.originalVersion, selection.originalHash]),
    ...(context.expectedVersion === 0 ? [db.prepare("INSERT INTO extraction_jobs (owner_id,id,version,last_request_id,upload_id,selection,updated_at) VALUES (?,?,1,?,?,?,?)").bind(context.owner.userId, selection.materialId, requestId, transfer.id, JSON.stringify(selection), Date.now())] : guardedUpdate(db, "extraction_jobs", context.owner.userId, selection.materialId, context.expectedVersion, requestId, 1, "upload_id=?,selection=?,updated_at=?", [transfer.id, JSON.stringify(selection), Date.now()], "1=1", [])),
    ...selection.pages.map((page) => db.prepare("INSERT INTO extraction_pages (owner_id,id,job_id,selection_revision,file_page,version,last_request_id,result_version,state,updated_at) VALUES (?,?,?,?,?,1,?,0,'pending',?)").bind(context.owner.userId, crypto.randomUUID(), selection.materialId, context.expectedVersion + 1, page.filePage, requestId, Date.now())),
  ]);
}
