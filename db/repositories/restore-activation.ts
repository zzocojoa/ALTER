import { z } from "zod";
import { backupFailure } from "../../lib/backup/contracts.ts";
import { recordId, timestamp } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import type { StorageContext } from "../../lib/backup/storage-identity.ts";
import { readStorage } from "./atomic.ts";
import type { AtomicDatabase } from "./atomic.ts";
import { backupGuard } from "./backup.ts";
import { readRestoreManifest } from "./restore-receiving.ts";
import { readRestoredOriginal } from "./restore-originals.ts";

const activationSchema = z.object({ run_id: recordId, revision: z.number().int().nonnegative().safe(), activated_at: timestamp, external_authority: z.literal("unverified") }).strict();
export type RestoreActivation = Readonly<z.infer<typeof activationSchema>>;
async function savedActivation(db: AtomicDatabase, id: string): Promise<RestoreActivation | null> {
  const row = await db.prepare("SELECT * FROM restore_activations WHERE run_id=?").bind(id).first(); return row === null ? null : activationSchema.parse(row);
}
/** 완료 검증과 같은 DB 버전만 활성화합니다. 활성화 뒤 새 학습은 허용하되 외부 실행 권한은 부여하지 않습니다. */
export async function activateRestore(db: AtomicDatabase, bucket: R2Bucket, context: StorageContext, owner: SiteIdentity, id: string, now: number): Promise<RestoreActivation> {
  recordId.parse(id); timestamp.parse(now); const archive = await readRestoreManifest(db, bucket, context, owner, id);
  return readStorage("restore.activation", async () => {
    const previous = await savedActivation(db, id);
    if (previous !== null) {
      const state = await db.prepare("SELECT state FROM restore_runs WHERE id=? AND owner_id=?").bind(id, owner.userId).first<string>("state");
      if (state !== "activated") throw backupFailure("export-conflict", "restore.activation-state"); return previous;
    }
    const verification = await db.prepare("SELECT revision,completed_at FROM restore_verifications WHERE run_id=?").bind(id).first<{ revision: number; completed_at: number | null }>();
    if (verification === null || verification.completed_at === null || now < verification.completed_at) throw backupFailure("export-conflict", "restore.activation-verification-required");
    for (const [ordinal] of archive.document.manifest.objects.entries()) {
      const receipt = await readRestoredOriginal(db, id, archive.document.manifest, ordinal); const object = await bucket.head(receipt.source.entry.objectKey);
      if (object === null || object.version !== receipt.objectVersion || object.etag !== receipt.etag || object.size !== receipt.source.entry.bytes) throw backupFailure("object-changed", "restore.activation-original-changed");
    }
    const guard: string = crypto.randomUUID();
    try { await db.batch([
      db.prepare("INSERT INTO restore_activations(run_id,revision,activated_at,external_authority) VALUES (?,?,?,'unverified') ON CONFLICT(run_id) DO NOTHING").bind(id, verification.revision, now),
      backupGuard(db, guard, "EXISTS(SELECT 1 FROM restore_activations a JOIN restore_runs r ON r.id=a.run_id WHERE a.run_id=? AND a.revision=? AND r.owner_id=? AND r.state='verified' AND a.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=r.owner_id),0))", [id, verification.revision, owner.userId]),
      db.prepare("UPDATE restore_runs SET state='activated' WHERE id=? AND owner_id=? AND state='verified'").bind(id, owner.userId),
      backupGuard(db, `${guard}-final`, "EXISTS(SELECT 1 FROM restore_activations a JOIN restore_runs r ON r.id=a.run_id WHERE r.id=? AND r.owner_id=? AND r.state='activated' AND a.revision=? AND a.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=r.owner_id),0))", [id, owner.userId, verification.revision]),
      db.prepare("DELETE FROM backup_checks WHERE id IN (?,?)").bind(guard, `${guard}-final`),
    ]); } catch (error: unknown) {
      const committed = await savedActivation(db, id);
      const state = await db.prepare("SELECT state FROM restore_runs WHERE id=? AND owner_id=?").bind(id, owner.userId).first<string>("state");
      if (committed !== null && state === "activated" && committed.revision === verification.revision) return committed;
      throw error;
    }
    const saved = await savedActivation(db, id); if (saved === null) throw backupFailure("export-conflict", "restore.activation-missing"); return saved;
  });
}
