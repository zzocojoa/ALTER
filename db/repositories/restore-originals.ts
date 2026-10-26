import type { BackupManifest } from "../../lib/backup/contracts.ts";
import { z } from "zod";
import { canonicalJson, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { backupFailure, backupPagePath, backupObjectEntry } from "../../lib/backup/contracts.ts";
import { planRestoreOriginal, restoreOriginalInput } from "../../lib/backup/restore-original.ts";
import type { RestoreOriginalInput, RestoreOriginalPlan } from "../../lib/backup/restore-original.ts";
import { receiveOriginalBytes, verifyRestoredOriginal } from "../../lib/backup/restore-original-stream.ts";
import type { StorageContext } from "../../lib/backup/storage-identity.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase } from "./atomic.ts";
import { backupGuard } from "./backup.ts";
import { readRestoreManifest, readReceivedRestorePage } from "./restore-receiving.ts";

const originalRow = z.object({ run_id: z.string(), ordinal: z.number().int().nonnegative(), plan: z.string(), source_pages: z.string(), state: z.enum(["reserved", "verified"]), object_version: z.string().nullable(), etag: z.string().nullable(), created_at: timestamp, verified_at: timestamp.nullable() }).strict();
type OriginalRow = Readonly<z.infer<typeof originalRow>>;
export type RestoredOriginalReceipt = Readonly<{ runId: string; ordinal: number; state: "verified"; source: RestoreOriginalPlan; objectVersion: string; etag: string }>;
function receipt(row: OriginalRow, plan: RestoreOriginalPlan): RestoredOriginalReceipt {
  if (row.state !== "verified" || row.object_version === null || row.etag === null) throw backupFailure("incomplete-download", "restore.original-not-verified");
  return { runId: row.run_id, ordinal: row.ordinal, state: "verified", source: plan, objectVersion: row.object_version, etag: row.etag };
}
async function readOriginal(db: AtomicDatabase, id: string, ordinal: number): Promise<OriginalRow | null> {
  const row = await readStorage("restore.original-receipt", () => db.prepare("SELECT run_id,ordinal,plan,source_pages,state,object_version,etag,created_at,verified_at FROM restore_originals WHERE run_id=? AND ordinal=?").bind(id, ordinal).first<OriginalRow>());
  return row === null ? null : originalRow.parse(row);
}
function requireBody(request: Pick<Request, "headers" | "body">, bytes: number): void {
  if (request.headers.get("content-type") !== "application/octet-stream" || request.headers.get("content-encoding") !== null || request.headers.get("content-length") !== String(bytes) || request.body === null) throw backupFailure("invalid-object", "restore.original-body-headers");
}
/** 예약은 원본마다 한 번만 만들며 R2 완료와 DB 완료 사이의 응답 유실에도 같은 식별자를 유지합니다. */
export async function receiveRestoreOriginal(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, input: RestoreOriginalInput, request: Pick<Request, "headers" | "body" | "signal">, now: number): Promise<RestoredOriginalReceipt> {
  restoreOriginalInput.parse(input); timestamp.parse(now);
  const archive = await readRestoreManifest(db, bucket, context, owner, id);
  if (archive.run.state !== "receiving") throw backupFailure("export-conflict", "restore.original-run-state");
  const upload = await readReceivedRestorePage(db, bucket, archive, backupPagePath("uploads", input.uploadPage));
  const transfer = await readReceivedRestorePage(db, bucket, archive, backupPagePath("material_transfers", input.transferPage));
  const plan = planRestoreOriginal(archive.document.manifest, input, upload, transfer); requireBody(request, plan.entry.bytes);
  const encoded: string = canonicalJson(plan); const sourcePages: string = canonicalJson(input); const guard: string = crypto.randomUUID();
  const runCheck = (): D1PreparedStatement => backupGuard(db, guard, "EXISTS(SELECT 1 FROM restore_runs r JOIN restore_archives a ON a.run_id=r.id WHERE r.id=? AND r.state='receiving' AND r.authorization=? AND a.state='ready' AND a.manifest_sha256=?)", [id, canonicalJson(archive.run.authorization), archive.receipt.manifestSha256]);
  await readStorage("restore.original-reserve", () => db.batch([
    runCheck(),
    db.prepare("INSERT INTO restore_originals(run_id,ordinal,plan,source_pages,state,created_at) VALUES (?,?,?,?,'reserved',?) ON CONFLICT(run_id,ordinal) DO NOTHING").bind(id, input.ordinal, encoded, sourcePages, now),
    db.prepare("DELETE FROM backup_checks WHERE id=?").bind(guard),
  ]));
  const saved = await readOriginal(db, id, input.ordinal);
  if (saved === null || saved.plan !== encoded || saved.source_pages !== sourcePages) throw backupFailure("export-conflict", "restore.original-reservation");
  if (saved.state === "verified") {
    await request.body?.cancel();
    const observed = await verifyRestoredOriginal(bucket, id, plan, AbortSignal.any([request.signal, AbortSignal.timeout(60000)]));
    if (observed.object.version !== saved.object_version || observed.object.etag !== saved.etag) throw backupFailure("object-changed", "restore.original-receipt-version"); return receipt(saved, plan);
  }
  const verified = await receiveOriginalBytes(bucket, id, plan, request);
  await readStorage("restore.original-confirm", () => db.batch([
    runCheck(),
    db.prepare("UPDATE restore_originals SET state='verified',object_version=?,etag=?,verified_at=? WHERE run_id=? AND ordinal=? AND state='reserved' AND plan=? AND source_pages=?").bind(verified.object.version, verified.object.etag, now, id, input.ordinal, encoded, sourcePages),
    backupGuard(db, `${guard}-verified`, "EXISTS(SELECT 1 FROM restore_originals WHERE run_id=? AND ordinal=? AND state='verified' AND object_version=? AND etag=? AND plan=? AND source_pages=?)", [id, input.ordinal, verified.object.version, verified.object.etag, encoded, sourcePages]),
    db.prepare("DELETE FROM backup_checks WHERE id IN (?,?)").bind(guard, `${guard}-verified`),
  ]));
  const completed = await readOriginal(db, id, input.ordinal); if (completed === null) throw backupFailure("missing-export", "restore.original-receipt-missing"); return receipt(completed, plan);
}

/** 선언과 수신 영수증이 같은 원본인지 확인하고 새 객체 버전 대응만 반환합니다. */
export async function readRestoredOriginal(db: AtomicDatabase, runId: string, manifest: BackupManifest, ordinal: number): Promise<RestoredOriginalReceipt> {
  const row = await readOriginal(db, runId, ordinal); const entry = manifest.objects[ordinal];
  if (row === null || entry === undefined) throw backupFailure("incomplete-download", "restore.original-receipt-missing");
  const plan = z.object({ entry: backupObjectEntry, mime: z.string(), originalUploadId: z.string() }).strict().parse(JSON.parse(row.plan));
  if (canonicalJson(plan.entry) !== canonicalJson(entry)) throw backupFailure("invalid-object", "restore.original-receipt-manifest");
  return receipt(row, plan);
}
